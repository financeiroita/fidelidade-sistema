import { createHmac } from 'node:crypto';
import { onlyDigits } from '../../domain/guests/cpf';

export type DocumentType = 'CPF' | 'PASSPORT';

/** Normaliza para comparação: CPF só dígitos; passaporte em maiúsculas sem espaços. */
export function normalizeDocument(value: string, type: DocumentType): string {
  return type === 'CPF' ? onlyDigits(value) : value.replace(/\s+/g, '').toUpperCase();
}

/**
 * Hash com chave (HMAC-SHA256) do documento. É determinístico, então permite
 * busca e unicidade (e casar com o CPF vindo do Erbon) sem guardar o CPF em claro.
 */
export function hashDocument(value: string, type: DocumentType, secret: string): string {
  return createHmac('sha256', secret).update(`${type}:${normalizeDocument(value, type)}`).digest('hex');
}

/** Últimos 4 caracteres, para exibição mascarada. */
export const documentLast4 = (value: string, type: DocumentType) => normalizeDocument(value, type).slice(-4);
