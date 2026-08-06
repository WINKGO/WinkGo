/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

const VERIFICATION_KEYWORDS =
  /验证码|校验码|验证代码|登录代码|安全代码|动态码|一次性(?:密码|代码)|临时(?:登录)?代码|verification\s*code|security\s*code|login\s*code|sign[ -]?in\s*code|one[ -]?time(?:\s+(?:password|code))?|passcode|\botp\b/i;

const normalizeText = (value: string): string =>
  value
    .replace(/[０-９]/g, (character) => String(character.charCodeAt(0) - 0xff10))
    .replace(/[\u200b-\u200d\ufeff]/g, ' ')
    .replace(/\u00a0/g, ' ');

const collectNumericCodes = (value: string): string[] => {
  const matches = normalizeText(value).matchAll(/(?<!\d)(\d(?:[\s-]?\d){3,7})(?!\d)/g);
  return [...matches]
    .map((match) => match[1].replace(/\D/g, ''))
    .filter((code) => code.length >= 4 && code.length <= 8)
    .filter((code) => !(code.length === 4 && /^(?:19|20)\d{2}$/.test(code)));
};

const preferVerificationCode = (codes: string[]): string | null =>
  codes.find((code) => code.length === 6) ||
  codes.find((code) => code.length === 8) ||
  codes.find((code) => code.length === 5) ||
  codes.find((code) => code.length === 4) ||
  codes[0] ||
  null;

export const isLikelyVerificationMail = (input: {
  senderName?: string;
  senderAddress?: string;
  subject?: string;
}): boolean =>
  VERIFICATION_KEYWORDS.test(`${input.subject || ''}\n${input.senderName || ''}\n${input.senderAddress || ''}`);

export const extractMailVerificationCode = (subject: string, body = ''): string | null => {
  const normalizedSubject = normalizeText(subject);
  const normalizedBody = normalizeText(body);
  const combined = `${normalizedSubject}\n${normalizedBody}`;
  if (!VERIFICATION_KEYWORDS.test(combined)) return null;

  const keywordMatches = [...combined.matchAll(new RegExp(VERIFICATION_KEYWORDS.source, 'gi'))];
  const nearbyCodes = keywordMatches.flatMap((match) => {
    const index = match.index || 0;
    return collectNumericCodes(combined.slice(Math.max(0, index - 48), index + match[0].length + 96));
  });
  const nearbyCode = preferVerificationCode(nearbyCodes);
  if (nearbyCode) return nearbyCode;

  // Some providers put the keyword in the subject and render the code as the
  // first standalone line in the body. Prefer six-digit values to avoid dates.
  return preferVerificationCode([...collectNumericCodes(normalizedBody), ...collectNumericCodes(normalizedSubject)]);
};
