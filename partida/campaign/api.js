export class ApiError extends Error {
  constructor(message, status = 0, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class ApiClient {
  constructor(base, session, fetcher = (url, options) => globalThis.fetch(url, options), clock = Date.now) {
    this.base = base.trim().replace(/\/$/, '');
    this.session = session;
    this.fetcher = fetcher;
    this.clock = clock;
    this.blockedUntil = 0;
    if (this.base) {
      const url = new URL(this.base);
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash
        || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
        throw Error('La API debe usar HTTPS o una dirección local sin credenciales.');
      }
    }
  }

  async request(path, options = {}) {
    if (!this.base) {
      throw new ApiError('Servicio de campañas no configurado', 503);
    }
    if (this.clock() < this.blockedUntil) {
      throw new ApiError('Espera antes de volver a intentarlo.', 429, (this.blockedUntil - this.clock()) / 1000);
    }
    const headers = new Headers();
    let requestToken;
    if (options.auth !== false) {
      const session = this.session.read();
      if (!session) {
        throw new ApiError('La sesión ha caducado. Entra de nuevo.', 401);
      }
      headers.set('Authorization', `Bearer ${session.token}`);
      requestToken = session.token;
    }
    if (options.admin) {
      headers.set('X-Admin-Key', options.admin);
    }
    if (options.revision !== undefined) {
      headers.set('If-Match', `"${options.revision}"`);
    }
    if (options.sessionNumber !== undefined) {
      headers.set('X-Session-Number', String(options.sessionNumber));
    }
    let body;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
    if (options.raw !== undefined) {
      headers.set('Content-Type', options.contentType ?? 'application/json');
      body = options.raw;
    }
    let response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      });
    } catch (error) {
      throw new ApiError(`No se pudo conectar con el servicio: ${error.message}`);
    }
    if (requestToken && this.session.read()?.token !== requestToken) {
      throw new ApiError('La sesión ha caducado. Entra de nuevo.', 401);
    }
    if (!response.ok) {
      const retryHeader = response.headers.get('Retry-After');
      const seconds = Number(retryHeader);
      const dateSeconds = (Date.parse(retryHeader) - this.clock()) / 1000;
      const retry = Math.max(1, Number.isFinite(seconds) && seconds > 0 ? seconds : dateSeconds || 60);
      if (response.status === 429) {
        this.blockedUntil = this.clock() + retry * 1000;
      }
      let message = `Error del servicio (${response.status}).`;
      try {
        message = (await response.json()).error?.message || message;
      } catch {
        // Un proxy puede devolver un error sin JSON.
      }
      throw new ApiError(message, response.status, retry);
    }
    if (response.status === 204) {
      return null;
    }
    return options.blob ? response.blob() : response.json();
  }
}
