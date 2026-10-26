export const SESSION_KEY = 'senda.narrator.session';
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

export function configurationState(base) {
  return {
    enabled: Boolean(base.trim()),
    message: base.trim() ? 'Crea una campaña o entra como narrador.' : 'Servicio de campañas no configurado'
  };
}

export async function openNextSession(before, request, reload) {
  try {
    await request();
    return {opened: true};
  } catch (error) {
    if (error.status !== 412) {
      throw error;
    }
    const current = await reload();
    const unchanged = current.session_number === before.session_number && current.state === before.state;
    return {
      opened: false,
      message: unchanged
        ? 'No se puede abrir la siguiente sesión: puede haber propuestas pendientes de resolver. Revisa la ficha de cada jugador.'
        : 'El estado de la sesión ha cambiado. La campaña se ha recargado; revisa su estado antes de continuar.'
    };
  }
}

export class SessionStore {
  constructor(storage, clock = Date.now, role = 'narrator') {
    this.storage = storage;
    this.clock = clock;
    this.role = role;
    this.key = role === 'player' ? 'senda.player.session' : SESSION_KEY;
  }

  save(response) {
    const session = {
      token: response.token,
      campaignId: response.campaignId,
      role: response.role,
      expiresAt: Math.min(response.expiresAt, this.clock() + EIGHT_HOURS)
    };
    if (this.role === 'player') {
      session.playerId = response.playerId;
    }
    if (!this.valid(session)) {
      throw Error('La respuesta no contiene una sesión válida de narrador.');
    }
    this.storage.setItem(this.key, JSON.stringify(session));
    return session;
  }

  valid(session) {
    return session?.role === this.role
      && ['narrator', 'player'].includes(this.role)
      && (this.role !== 'player' || typeof session.playerId === 'string' && Boolean(session.playerId))
      && /^[A-Za-z0-9_-]{43}$/.test(session.token)
      && typeof session.campaignId === 'string'
      && Number.isFinite(session.expiresAt)
      && session.expiresAt > this.clock()
      && session.expiresAt <= this.clock() + EIGHT_HOURS;
  }

  read() {
    try {
      const session = JSON.parse(this.storage.getItem(this.key));
      if (this.valid(session)) {
        return session;
      }
    } catch {
      // Una sesión dañada o un almacenamiento bloqueado no autentican.
    }
    this.clear();
    return null;
  }

  clear() {
    this.storage.removeItem(this.key);
  }
}

export class ReviewState {
  constructor() {
    this.clear();
  }

  clear() {
    this.player = null;
    this.data = null;
    this.groups = [];
    this.decisions = {};
    this.generation = (this.generation ?? 0) + 1;
  }

  load(player, data, groups) {
    this.clear();
    this.player = player;
    this.data = data;
    this.groups = groups;
  }

  decide(id, decision) {
    if (!this.groups.some(group => group.id === id)
      || !['accept', 'reject'].includes(decision)) {
      throw Error('Decisión no válida.');
    }
    this.decisions[id] = decision;
    this.generation++;
  }

  complete() {
    return Boolean(this.data?.official && this.data?.pending)
      && this.groups.every(group => Object.hasOwn(this.decisions, group.id));
  }
}

export function errorMessage(error) {
  if (error.status === 412) {
    return 'La revisión ha cambiado (412). Recarga la campaña y revisa de nuevo. Se han descartado las decisiones anteriores.';
  }
  if (error.status === 429) {
    return `Demasiados intentos (429). Espera ${Math.max(1, Math.ceil(error.retryAfter || 60))} segundos y vuelve a intentarlo.`;
  }
  if (error.status === 0) {
    return `${error.message} No se ha confirmado la operación. Recarga la campaña antes de repetirla.`;
  }
  if (error.status === 503) {
    return 'Servicio no disponible. No se ha confirmado la operación. Recarga la campaña antes de repetirla.';
  }
  return error.message;
}
