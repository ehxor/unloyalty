/** GS1 mod-10 check digit for a digit string without its check digit (EAN-8/13, UPC-A, ITF-14). */
export function gtinCheckDigit(body: string): string {
  let sum = 0;
  // Weights alternate 3,1,... starting from the rightmost body digit.
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return String((10 - (sum % 10)) % 10);
}

export function hasValidGtinCheck(code: string): boolean {
  return /^\d{2,}$/.test(code) && gtinCheckDigit(code.slice(0, -1)) === code.slice(-1);
}

/** Expand an 8-digit UPC-E (number system + 6 digits + check) to 12-digit UPC-A. */
export function upcEToUpcA(upce: string): string {
  if (!/^[01]\d{7}$/.test(upce)) throw new Error('UPC-E must be 8 digits starting with 0 or 1');
  const ns = upce[0]!;
  const d = upce.slice(1, 7);
  const check = upce[7]!;
  const last = d[5]!;
  let body: string;
  switch (last) {
    case '0':
    case '1':
    case '2':
      body = d.slice(0, 2) + last + '0000' + d.slice(2, 5);
      break;
    case '3':
      body = d.slice(0, 3) + '00000' + d.slice(3, 5);
      break;
    case '4':
      body = d.slice(0, 4) + '00000' + d[4];
      break;
    default:
      body = d.slice(0, 5) + '0000' + last;
  }
  return ns + body + check;
}

/** Compress a 12-digit UPC-A to UPC-E, or null if it isn't zero-suppressible. */
export function upcAToUpcE(upca: string): string | null {
  if (!/^[01]\d{11}$/.test(upca)) return null;
  const ns = upca[0]!;
  const mfr = upca.slice(1, 6);
  const prod = upca.slice(6, 11);
  const check = upca[11]!;
  let d: string | null = null;
  if (/^\d\d[012]00$/.test(mfr) && prod.startsWith('00')) d = mfr.slice(0, 2) + prod.slice(2) + mfr[2];
  else if (mfr.endsWith('00') && prod.startsWith('000')) d = mfr.slice(0, 3) + prod.slice(3) + '3';
  else if (mfr.endsWith('0') && prod.startsWith('0000')) d = mfr.slice(0, 4) + prod[4] + '4';
  else if (prod.startsWith('0000') && /[5-9]/.test(prod[4]!)) d = mfr + prod[4];
  if (d === null) return null;
  const upce = ns + d + check;
  return upcEToUpcA(upce) === upca ? upce : null;
}
