import { buildApp } from '../src/api/app';
import type { GuestRepository } from '../src/application/ports';
import { InMemoryGuestRepository } from '../src/infra/memory/guestRepository';
import { InMemoryStayRepository } from '../src/infra/memory/stayRepository';

export const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
export const API_KEY = 'chave-interna-de-teste-24+chars';

export function makeApp(repo: GuestRepository = new InMemoryGuestRepository(), now?: () => Date) {
  const guests = repo as InMemoryGuestRepository;
  const stays = new InMemoryStayRepository(guests);
  const app = buildApp({
    signup: { repo, documentSecret: SECRET, now },
    loyalty: { stays, now },
    internalApiKey: API_KEY,
  });
  return { app, guests, stays };
}
