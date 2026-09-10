import { formatDecimal, multiplyRounded, parseDecimal } from './decimal.ts';

export type ValidationIssue = {
  code: 'invalid_shape' | 'invalid_decimal' | 'unsupported_currency' | 'unsupported_unit' |
    'arithmetic_mismatch' | 'invalid_payment_state' | 'invalid_date' | 'reference_missing' |
    'reference_unknown' | 'reference_inaccessible' | 'reference_mismatch';
  path: string;
  severity: 'error' | 'unresolved';
  message: string;
};
export type ValidationReport = { profile: 'dtp.invoice-arithmetic/1'; valid: boolean; complete: boolean; issues: ValidationIssue[] };
export type ReferenceObservation =
  | { status: 'present'; type: string; seller_company_id?: string; buyer_company_id?: string }
  | { status: 'missing' | 'unknown' | 'inaccessible' };
export type InvoiceValidationOptions = {
  /** Caller must perform authorization before returning evidence. No existence oracle is supplied here. */
  resolveReference?: (id: string, expectedType: string) => ReferenceObservation;
};

const UNITS = new Set(['lb', 'kg', 'oz', 'ton', 'case', 'pallet', 'unit']);
const CURRENCIES = new Set(['USD', 'USDC']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Supplemental profile checks, not a replacement for JSON schema, signatures or authorization. */
export function validateInvoice(body: unknown, options: InvoiceValidationOptions = {}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssue['code'], path: string, message: string, severity: ValidationIssue['severity'] = 'error') =>
    issues.push({ code, path, severity, message });
  const report = (): ValidationReport => ({ profile: 'dtp.invoice-arithmetic/1',
    valid: !issues.some(i => i.severity === 'error'), complete: issues.length === 0, issues });
  if (!isObject(body)) { add('invalid_shape', '$', 'invoice must be an object'); return report(); }
  const totalObject = body.total;
  const currency = isObject(totalObject) ? totalObject.currency : undefined;
  if (typeof currency !== 'string' || !CURRENCIES.has(currency)) add('unsupported_currency', 'total.currency', 'profile supports USD and USDC without conversion');

  const amount = (raw: unknown, path: string): bigint | undefined => {
    if (!isObject(raw)) { add('invalid_shape', path, 'expected money object'); return; }
    if (raw.currency !== currency) add('unsupported_currency', `${path}.currency`, 'all amounts must use the invoice currency');
    try { return parseDecimal(raw.amount, 6); }
    catch (error) { add('invalid_decimal', `${path}.amount`, (error as Error).message); return; }
  };
  const equal = (actual: bigint | undefined, expected: bigint, path: string): void => {
    try {
      const normalized = formatDecimal(expected, 6); // Also checks cumulative magnitude.
      if (actual !== undefined && actual !== expected) add('arithmetic_mismatch', path, `expected ${normalized} ${String(currency)}`);
    } catch (error) { add('invalid_decimal', path, (error as Error).message); }
  };
  const subtotal = amount(body.subtotal, 'subtotal');
  const total = amount(body.total, 'total');
  const paid = amount(body.paid_amount, 'paid_amount');
  let sum = 0n;
  let linesValid = true;
  if (!Array.isArray(body.line_items) || body.line_items.length < 1 || body.line_items.length > 1000) {
    add('invalid_shape', 'line_items', 'expected 1 to 1000 invoice lines'); linesValid = false;
  } else for (const [index, line] of body.line_items.entries()) {
    const path = `line_items[${index}]`;
    if (!isObject(line) || !isObject(line.quantity)) { add('invalid_shape', path, 'expected line and quantity objects'); linesValid = false; continue; }
    if (typeof line.quantity.unit !== 'string' || !UNITS.has(line.quantity.unit)) add('unsupported_unit', `${path}.quantity.unit`, 'unit requires an explicit supported profile');
    let quantity: bigint | undefined;
    try { quantity = parseDecimal(line.quantity.amount, 3); }
    catch (error) { add('invalid_decimal', `${path}.quantity.amount`, (error as Error).message); }
    const price = amount(line.unit_price, `${path}.unit_price`);
    const value = amount(line.amount, `${path}.amount`);
    if (quantity === undefined || price === undefined || value === undefined) { linesValid = false; continue; }
    const expected = multiplyRounded(quantity, 3, price, 6, 6);
    equal(value, expected, `${path}.amount`);
    sum += value;
  }
  if (linesValid) equal(subtotal, sum, 'subtotal.amount');
  let deductions = 0n;
  let deductionsValid = true;
  if (!Array.isArray(body.deductions) || body.deductions.length > 1000) {
    add('invalid_shape', 'deductions', 'expected at most 1000 deductions'); deductionsValid = false;
  } else for (const [index, deduction] of body.deductions.entries()) {
    const value = amount(isObject(deduction) ? deduction.amount : undefined, `deductions[${index}].amount`);
    if (value === undefined) deductionsValid = false; else deductions += value;
  }
  if (subtotal !== undefined && deductionsValid) {
    if (deductions > subtotal) add('arithmetic_mismatch', 'deductions', 'deductions exceed subtotal; use an explicit credit-note profile');
    equal(total, subtotal - deductions, 'total.amount');
  }
  if (paid !== undefined && total !== undefined) {
    if (paid > total) add('invalid_payment_state', 'paid_amount', 'paid amount exceeds invoice total');
    if (body.status === 'paid' && paid !== total) add('invalid_payment_state', 'status', 'paid requires exact total payment');
    if (body.status === 'partially_paid' && !(paid > 0n && paid < total)) add('invalid_payment_state', 'status', 'partially_paid requires payment between zero and total');
  }
  const date = (v: unknown, path: string): string | undefined => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(v) ||
        !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 19) !== v.slice(0, 19)) {
      add('invalid_date', path, 'expected a real UTC date/time'); return;
    }
    // Preserve microseconds when comparing; Date alone truncates them.
    return `${v.slice(0, 19)}.${(v.includes('.') ? v.slice(20, -1) : '').padEnd(6, '0')}Z`;
  };
  const issued = date(body.issued_at, 'issued_at');
  const due = date(body.due_at, 'due_at');
  if (issued && due && due < issued) add('invalid_date', 'due_at', 'due time must not precede issue time');

  const references: Array<[unknown, string, string]> = [[body.contract_id, 'trade.contract', 'contract_id']];
  if (body.fulfillment_id != null) references.push([body.fulfillment_id, 'trade.fulfillment', 'fulfillment_id']);
  if (!Array.isArray(body.settlement_event_ids) || body.settlement_event_ids.length > 1000) {
    add('invalid_shape', 'settlement_event_ids', 'expected at most 1000 settlement references');
  } else {
    if (new Set(body.settlement_event_ids).size !== body.settlement_event_ids.length) add('reference_mismatch', 'settlement_event_ids', 'duplicate settlement reference');
    body.settlement_event_ids.forEach((id, index) => references.push([id, 'finance.settlement_event', `settlement_event_ids[${index}]`]));
  }
  for (const [id, expectedType, path] of references) {
    if (typeof id !== 'string' || !UUID.test(id)) { add('invalid_shape', path, 'expected a record UUID'); continue; }
    let observation: ReferenceObservation = { status: 'unknown' };
    try { observation = options.resolveReference?.(id, expectedType) ?? observation; }
    catch { observation = { status: 'unknown' }; }
    if (!observation || !['present', 'missing', 'unknown', 'inaccessible'].includes(observation.status)) observation = { status: 'unknown' };
    if (observation.status !== 'present') {
      add(`reference_${observation.status}`, path, `reference evidence is ${observation.status}; no verification inferred`, 'unresolved');
      continue;
    }
    if (observation.type !== expectedType) add('reference_mismatch', path, `expected reference type ${expectedType}`);
    for (const party of ['seller_company_id', 'buyer_company_id'] as const) {
      if (observation[party] !== undefined && observation[party] !== body[party]) add('reference_mismatch', path, `reference ${party} does not match invoice`);
    }
  }
  return report();
}
