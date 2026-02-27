import { request } from 'undici';
import type { FastifyBaseLogger } from 'fastify';
import { XMLParser } from 'fast-xml-parser';
import type { AppConfig } from '../config/env';

interface DavResponse {
  href: string;
  displayName?: string;
  resourceTypes: string[];
  currentUserPrincipalHref?: string;
  calendarHomeSetHref?: string;
  etag?: string;
}

export interface UpsertEventInput {
  uid: string;
  iCal: string;
  href?: string | null;
  etag?: string | null;
}

export interface UpsertEventResult {
  href: string;
  etag: string | null;
}

interface RequestResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
}

class RetryableError extends Error {}

class CaldavAuthError extends Error {}

export class CaldavClient {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
  });

  private calendarUrl: string | null = null;
  private authHealthy = true;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: FastifyBaseLogger,
  ) {}

  isAuthHealthy(): boolean {
    return this.authHealthy;
  }

  async discoverCalendar(force = false): Promise<string> {
    if (this.calendarUrl && !force) {
      return this.calendarUrl;
    }

    const base = ensureTrailingSlash(this.config.CALDAV_BASE_URL);
    const principal = await this.withRetry('discover-principal', async () => {
      const response = await this.propfind(
        base,
        '0',
        `<d:propfind xmlns:d="DAV:">
          <d:prop>
            <d:current-user-principal/>
            <d:resourcetype/>
          </d:prop>
        </d:propfind>`,
      );

      this.throwOnUnexpectedStatus(response, [200, 207], 'discover principal');
      const rows = this.parseDavResponses(response.bodyText);
      const first = rows[0];
      if (!first) {
        return base;
      }

      if (first.currentUserPrincipalHref) {
        return new URL(first.currentUserPrincipalHref, base).toString();
      }

      if (first.resourceTypes.includes('principal')) {
        return base;
      }

      return base;
    });

    const homeSet = await this.withRetry('discover-calendar-home-set', async () => {
      const response = await this.propfind(
        principal,
        '0',
        `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:prop>
            <c:calendar-home-set/>
          </d:prop>
        </d:propfind>`,
      );

      this.throwOnUnexpectedStatus(response, [200, 207], 'discover calendar home set');
      const rows = this.parseDavResponses(response.bodyText);
      const first = rows[0];
      if (!first?.calendarHomeSetHref) {
        return principal;
      }
      return new URL(first.calendarHomeSetHref, principal).toString();
    });

    const calendar = await this.withRetry('discover-calendars', async () => {
      const response = await this.propfind(
        homeSet,
        '1',
        `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:prop>
            <d:displayname/>
            <d:resourcetype/>
          </d:prop>
        </d:propfind>`,
      );

      this.throwOnUnexpectedStatus(response, [200, 207], 'list calendars');
      const rows = this.parseDavResponses(response.bodyText).filter((row) =>
        row.resourceTypes.includes('calendar'),
      );

      const matched = rows.find(
        (row) => (row.displayName ?? '').trim() === this.config.CALDAV_CALENDAR_NAME.trim(),
      );

      if (!matched) {
        throw new Error(`Calendar "${this.config.CALDAV_CALENDAR_NAME}" not found`);
      }

      return ensureTrailingSlash(new URL(matched.href, homeSet).toString());
    });

    this.calendarUrl = calendar;
    return calendar;
  }

  async upsertEvent(input: UpsertEventInput): Promise<UpsertEventResult> {
    const calendarUrl = await this.discoverCalendar();
    const targetHref =
      input.href ?? new URL(`${encodeURIComponent(input.uid)}.ics`, calendarUrl).toString();

    const result = await this.withRetry('upsert-event', async () => {
      const initialHeaders: Record<string, string> = {
        'content-type': 'text/calendar; charset=utf-8',
      };

      if (input.etag) {
        initialHeaders['if-match'] = input.etag;
      }

      const putResponse = await this.sendRequest(targetHref, 'PUT', input.iCal, initialHeaders);

      if ([200, 201, 204].includes(putResponse.statusCode)) {
        const etag =
          this.getHeader(putResponse.headers, 'etag') ?? (await this.fetchEtag(targetHref));
        return { href: targetHref, etag };
      }

      if (putResponse.statusCode === 400) {
        this.logger.error(
          {
            href: targetHref,
            status: putResponse.statusCode,
            response: truncate(putResponse.bodyText, 500),
            ical_preview: truncate(input.iCal, 500),
          },
          'CalDAV rejected VEVENT payload',
        );
      }

      if (putResponse.statusCode === 412 && input.etag) {
        const latestEtag = await this.fetchEtag(targetHref);
        const retryHeaders: Record<string, string> = {
          'content-type': 'text/calendar; charset=utf-8',
        };

        if (latestEtag) {
          retryHeaders['if-match'] = latestEtag;
        }

        const retryResponse = await this.sendRequest(targetHref, 'PUT', input.iCal, retryHeaders);
        if ([200, 201, 204].includes(retryResponse.statusCode)) {
          const etag =
            this.getHeader(retryResponse.headers, 'etag') ?? (await this.fetchEtag(targetHref));
          return { href: targetHref, etag };
        }

        this.throwOnUnexpectedStatus(retryResponse, [200, 201, 204], 'retry put event');
      }

      this.throwOnUnexpectedStatus(putResponse, [200, 201, 204], 'put event');
      return { href: targetHref, etag: null };
    });

    return result;
  }

  async deleteEvent(uid: string, href?: string | null): Promise<void> {
    const calendarUrl = await this.discoverCalendar();
    const targetHref = href ?? new URL(`${encodeURIComponent(uid)}.ics`, calendarUrl).toString();

    await this.withRetry('delete-event', async () => {
      const response = await this.sendRequest(targetHref, 'DELETE');
      if ([200, 202, 204, 404, 410].includes(response.statusCode)) {
        return;
      }
      this.throwOnUnexpectedStatus(response, [200, 202, 204, 404, 410], 'delete event');
    });
  }

  async pingCalendar(): Promise<void> {
    if (!this.authHealthy) {
      throw new Error('CalDAV auth is unhealthy');
    }

    const calendarUrl = await this.discoverCalendar();
    const response = await this.propfind(
      calendarUrl,
      '0',
      `<d:propfind xmlns:d="DAV:">
        <d:prop>
          <d:displayname/>
        </d:prop>
      </d:propfind>`,
    );

    this.throwOnUnexpectedStatus(response, [200, 207], 'ping calendar');
  }

  private async fetchEtag(href: string): Promise<string | null> {
    const response = await this.sendRequest(href, 'HEAD');
    if (response.statusCode === 404) {
      return null;
    }
    this.throwOnUnexpectedStatus(response, [200, 204], 'fetch etag');
    return this.getHeader(response.headers, 'etag');
  }

  private async propfind(url: string, depth: '0' | '1', body: string): Promise<RequestResponse> {
    return this.sendRequest(url, 'PROPFIND', body, {
      depth,
      'content-type': 'application/xml; charset=utf-8',
    });
  }

  private async sendRequest(
    url: string,
    method: string,
    body?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<RequestResponse> {
    try {
      const response = await request(url, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(
            `${this.config.CALDAV_USERNAME}:${this.config.CALDAV_PASSWORD}`,
          ).toString('base64')}`,
          ...extraHeaders,
        },
        body,
      });

      const bodyText = response.body ? await response.body.text() : '';
      if ([401, 403].includes(response.statusCode)) {
        this.authHealthy = false;
      }

      return {
        statusCode: response.statusCode,
        headers: response.headers as Record<string, string | string[] | undefined>,
        bodyText,
      };
    } catch (error) {
      throw new RetryableError(
        `Network error for ${method} ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private throwOnUnexpectedStatus(
    response: RequestResponse,
    expected: number[],
    operation: string,
  ): never | void {
    if (expected.includes(response.statusCode)) {
      return;
    }

    if ([401, 403].includes(response.statusCode)) {
      this.authHealthy = false;
      throw new CaldavAuthError(
        `${operation} failed with auth status ${response.statusCode}: ${response.bodyText}`,
      );
    }

    if (isTransientStatus(response.statusCode)) {
      throw new RetryableError(
        `${operation} failed with transient status ${response.statusCode}: ${response.bodyText}`,
      );
    }

    throw new Error(
      `${operation} failed with status ${response.statusCode}: ${truncate(response.bodyText, 400)}`,
    );
  }

  private async withRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof CaldavAuthError) {
          this.logger.error({ operation, err: error.message }, 'CalDAV auth failure');
          throw error;
        }

        const isRetryable = error instanceof RetryableError;
        if (!isRetryable || attempt === maxAttempts) {
          throw error;
        }

        const delay = 200 * 2 ** (attempt - 1);
        this.logger.warn(
          {
            operation,
            attempt,
            delay_ms: delay,
            err: error instanceof Error ? error.message : error,
          },
          'Retrying CalDAV operation',
        );
        await sleep(delay);
      }
    }

    throw new Error(`Unreachable retry state for ${operation}`);
  }

  private parseDavResponses(xml: string): DavResponse[] {
    if (!xml.trim()) {
      return [];
    }

    const parsed = this.parser.parse(xml) as Record<string, unknown>;
    const multistatus =
      (parsed.multistatus as Record<string, unknown> | undefined) ??
      (parsed.response ? ({ response: parsed.response } as Record<string, unknown>) : undefined);

    if (!multistatus) {
      return [];
    }

    const responses = toArray(multistatus.response);

    return responses
      .map((response) => this.parseSingleResponse(response as Record<string, unknown>))
      .filter((value): value is DavResponse => value !== null);
  }

  private parseSingleResponse(response: Record<string, unknown>): DavResponse | null {
    const href = firstText(response.href);
    if (!href) {
      return null;
    }

    const propstats = toArray(response.propstat);
    const result: DavResponse = {
      href,
      resourceTypes: [],
    };

    for (const propstat of propstats) {
      const statusText = firstText((propstat as Record<string, unknown>).status);
      if (!statusText || !statusText.includes('200')) {
        continue;
      }

      const prop = ((propstat as Record<string, unknown>).prop ?? {}) as Record<string, unknown>;

      const displayName = firstText(prop.displayname);
      if (displayName) {
        result.displayName = displayName;
      }

      const etag = firstText(prop.getetag);
      if (etag) {
        result.etag = etag;
      }

      const resourceTypes = extractResourceTypes(prop.resourcetype);
      if (resourceTypes.length > 0) {
        result.resourceTypes = resourceTypes;
      }

      const currentUserPrincipalHref = firstHref(prop['current-user-principal']);
      if (currentUserPrincipalHref) {
        result.currentUserPrincipalHref = currentUserPrincipalHref;
      }

      const calendarHomeSetHref = firstHref(prop['calendar-home-set']);
      if (calendarHomeSetHref) {
        result.calendarHomeSetHref = calendarHomeSetHref;
      }
    }

    return result;
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string | null {
    const header = headers[key.toLowerCase()];
    if (!header) {
      return null;
    }

    if (Array.isArray(header)) {
      return header[0] ?? null;
    }

    return header;
  }
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function firstText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstText(item);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function firstHref(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const href = firstHref(item);
      if (href) {
        return href;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.href) {
      return firstHref(record.href);
    }
    const keys = Object.keys(record);
    for (const key of keys) {
      if (key.toLowerCase().includes('href')) {
        const href = firstHref(record[key]);
        if (href) {
          return href;
        }
      }
    }
  }

  return null;
}

function extractResourceTypes(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record).map((key) => key.toLowerCase());
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function isTransientStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
