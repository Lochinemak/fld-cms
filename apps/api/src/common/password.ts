import { randomInt } from 'node:crypto';

// No 0/O, 1/l/I: generated passwords get read off logs and typed by hand.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePassword(length = 16): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
