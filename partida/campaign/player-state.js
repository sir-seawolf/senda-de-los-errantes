import {parse} from '../src/comparison.js';
import {errorMessage} from './state.js';

export const byteLength = text => new TextEncoder().encode(text).length;

export function takeInvitation(location, history) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has('invite')) {
    return null;
  }
  const code = params.get('invite');
  history.replaceState(null, '', location.pathname + location.search);
  if (!/^[A-Za-z0-9_-]{22}$/.test(code)) {
    return '';
  }
  return code;
}

export function validatePin(value, config) {
  const normalized = value.toUpperCase();
  if (normalized.length !== config.pinLength || [...normalized].some(char => !config.pinAlphabet.includes(char))) {
    throw Error(`El PIN debe tener ${config.pinLength} caracteres del alfabeto indicado.`);
  }
  return normalized;
}

export function weakPin(value) {
  return /^(.)\1+$/.test(value) || /^(123456|234567|345678|456789|ABCDEF|QWERTY)$/i.test(value);
}

export function generatePin(config, fill = bytes => crypto.getRandomValues(bytes)) {
  const alphabet = config.pinAlphabet;
  if (!alphabet || alphabet.length > 256 || !Number.isSafeInteger(config.pinLength) || config.pinLength < 1) {
    throw Error('Configuración de PIN no válida.');
  }
  const limit = 256 - 256 % alphabet.length;
  let result = '';
  while (result.length < config.pinLength) {
    const bytes = fill(new Uint8Array(config.pinLength * 2));
    for (const value of bytes) {
      if (value < limit && result.length < config.pinLength) {
        result += alphabet[value % alphabet.length];
      }
    }
  }
  return result;
}

export function checkSheet(text) {
  if (byteLength(text) > 256000) {
    throw Error('La ficha supera 256.000 bytes UTF-8.');
  }
  return parse(text);
}

export function sheetPermissions(campaign, me) {
  return {
    entry: me.status === 'pending' && campaign.state === 'open',
    proposal: me.status === 'approved' && campaign.state === 'closed'
  };
}

export function resolutionNotice(previous, review) {
  if (review.pending && review.official) {
    return 'Tu propuesta está pendiente de revisión';
  }
  if (previous?.pending && !review.pending && review.official) {
    return review.officialRevision > previous.officialRevision
      ? 'Tu propuesta ha sido aprobada. Descarga la ficha oficial para ver los cambios aceptados.'
      : 'Se ha mantenido tu ficha anterior.';
  }
  return '';
}

export function playerError(error) {
  if (error.status === 401) {
    return 'Credenciales o sesión no válidas. Vuelve a entrar con el enlace guardado, tu alias y PIN.';
  }
  if (error.status === 412) {
    return 'La revisión ha cambiado (412). Recarga el estado y comprueba tu archivo antes de volver a enviarlo. No se ha confirmado este envío.';
  }
  if (error.status === 409) {
    return 'No se puede realizar esta acción en el estado actual (409). Recarga el estado; si es un alta o un PIN olvidado, consulta al narrador. No se ha confirmado la operación.';
  }
  return errorMessage(error);
}
