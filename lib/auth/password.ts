import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

// Cost-12 hash used when the email is unknown, so login timing stays even.
const DUMMY_PASSWORD_HASH =
  "$2b$12$wmcwkDo/6xfGAYqyWRUN7O8bD3MeRXICKCsykt/.IL2iNM7wWns.u";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!passwordHash) {
    return false;
  }

  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

export function dummyPasswordHash(): string {
  return DUMMY_PASSWORD_HASH;
}

export function validateNewPassword(
  password: string,
  email: string,
): string | null {
  if (password.length < 10) {
    return "Password must be at least 10 characters.";
  }

  if (!/\p{L}/u.test(password)) {
    return "Password must include a letter.";
  }

  if (!/[0-9]/.test(password)) {
    return "Password must include a digit.";
  }

  if (password.toLowerCase() === email.toLowerCase()) {
    return "Password must not match your email.";
  }

  return null;
}

const PASSWORD_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PASSWORD_DIGITS = "23456789";
const PASSWORD_SYMBOLS = "!@#$%&*?";
const PASSWORD_ALPHABET = `${PASSWORD_LETTERS}${PASSWORD_DIGITS}${PASSWORD_SYMBOLS}`;
const GENERATED_PASSWORD_LENGTH = 14;

function randomChar(alphabet: string): string {
  return alphabet.charAt(randomInt(alphabet.length));
}

export function generatePassword(): string {
  const chars = [
    randomChar(PASSWORD_LETTERS),
    randomChar(PASSWORD_DIGITS),
    randomChar(PASSWORD_SYMBOLS),
  ];

  while (chars.length < GENERATED_PASSWORD_LENGTH) {
    chars.push(randomChar(PASSWORD_ALPHABET));
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = chars[index] ?? "";
    chars[index] = chars[swapIndex] ?? "";
    chars[swapIndex] = current;
  }

  return chars.join("");
}
