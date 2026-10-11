/**
 * Property tests for fractional-index.ts.
 * Run: npx tsx scripts/test-fractional-index.ts
 */
import { between, rebalanceKeys, assertSorted, isValidKey, MAX_KEY_LENGTH } from "../src/lib/utils/fractional-index";

function randKey(maxLen: number): string {
  const alpha = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
  const len = 1 + Math.floor(Math.random() * maxLen);
  let s = "";
  for (let i = 0; i < len; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  if (s[s.length - 1] === "-") s = s.slice(0, -1) + "1";
  return s;
}

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

// 1. Random pairwise between()
for (let t = 0; t < 200000; t++) {
  const a = randKey(6);
  const b = randKey(6);
  if (a >= b) continue;
  const x = between(a, b);
  check(isValidKey(x), `invalid key "${x}" between "${a}" and "${b}"`);
  check(a < x && x < b, `"${a}" < "${x}" < "${b}" violated`);
}

// 2. Unbounded cases
for (let t = 0; t < 50000; t++) {
  const a = randKey(6);
  const x = between(a, null);
  check(isValidKey(x) && x > a, `after("${a}") -> "${x}" must be > a`);
  const y = between(null, a);
  check(isValidKey(y) && y < a, `before("${a}") -> "${y}" must be < a`);
}

// 3. Random insertion into a growing sorted list (no rebalance)
{
  const keys: string[] = [];
  for (let t = 0; t < 5000; t++) {
    const pos = Math.floor(Math.random() * (keys.length + 1));
    const a = pos === 0 ? null : keys[pos - 1];
    const b = pos === keys.length ? null : keys[pos];
    const k = between(a, b);
    check(isValidKey(k), `invalid key "${k}"`);
    check((a === null || a < k) && (b === null || k < b), `between violated: ${a} < ${k} < ${b}`);
    keys.splice(pos, 0, k);
  }
  assertSorted(keys);
}

// 4. Random insert-sort simulation (fuzz a sorted list)
for (let t = 0; t < 2000; t++) {
  const keys = rebalanceKeys(1 + Math.floor(Math.random() * 12));
  assertSorted(keys);
  for (let ins = 0; ins < 30; ins++) {
    const pos = Math.floor(Math.random() * (keys.length + 1));
    const a = pos === 0 ? null : keys[pos - 1];
    const b = pos === keys.length ? null : keys[pos];
    const k = between(a, b);
    if (k.length > MAX_KEY_LENGTH) {
      // rebalance to keep keys short
      const list = [...keys.slice(0, pos), k, ...keys.slice(pos)];
      const fresh = rebalanceKeys(list.length);
      check(fresh.length === list.length, "rebalance length");
      assertSorted(fresh);
      keys.splice(0, keys.length, ...fresh);
      continue;
    }
    check(isValidKey(k), `invalid key "${k}" at pos ${pos}`);
    if (a !== null) check(a < k, `a < k: "${a}" < "${k}"`);
    if (b !== null) check(k < b, `k < b: "${k}" < "${b}"`);
    keys.splice(pos, 0, k);
  }
  assertSorted(keys);
}

// 5. Rebalance correctness for various n
for (let n = 1; n <= 300; n++) {
  const keys = rebalanceKeys(n);
  check(keys.length === n, `rebalance(${n}) length`);
  assertSorted(keys);
  check(keys.every((k) => k.length <= 8), `rebalance(${n}) keys too long: ${Math.max(...keys.map((k) => k.length))}`);
}

if (failures === 0) {
  console.log("All fractional-index property tests passed.");
} else {
  console.error(`${failures} failure(s).`);
  process.exit(1);
}
