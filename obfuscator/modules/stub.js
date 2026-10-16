/**
 * GNG Obfuscator - Stub Generator
 * Generates runtime stub for anti-detection and string decryption
 */

import {
  MODULUS_251,
  MODULUS_256,
  ANTI_DEBUG_LOOP_COUNT,
  ANTI_DEBUG_LOOP_DELAY_MS,
  ANTI_DEBUG_ACCUMULATION_MAX,
  ANTI_DEBUG_ACCUMULATION_EXPECTED,
  TOLERANCE_VECTOR3,
  TOLERANCE_CFRAME
} from './constants.js';
import { utf8Encode } from './crypto.js';

/**
 * Generate the runtime stub
 * @param {Object} options - Obfuscation options
 * @param {string} decryptorName - Name of decryptor function
 * @param {string} poolName - Name of string pool
 * @returns {string} Generated stub code
 */
export function generateStub(options, decryptorName, poolName) {
  const { placeId, userId, requirePath, rng } = options;
  const bound = placeId > 0 || userId > 0;
  const RP = bound ? (placeId % MODULUS_251) : 0;
  const RU = (bound && userId > 0) ? (userId % MODULUS_251) : -1;
  const SALT = bound ? ((placeId % MODULUS_251) + (userId > 0 ? ((userId * 13) % MODULUS_251) : 0)) % MODULUS_256 : 0;

  // Unbound stub (simple)
  if (!bound) {
    return generateUnboundStub(decryptorName);
  }

  // Bound stub with anti-detection
  return generateBoundStub(decryptorName, RP, RU, SALT, requirePath, rng);
}

/**
 * Generate unbound stub (no anti-detection)
 */
function generateUnboundStub(decryptorName) {
  return `local ${decryptorName}=function(h,k,q)local r={}for i=1,#h,2 do ` +
    `r[#r+1]=string.char((tonumber(h:sub(i,i+1),16)-k-q*7)%256)end ` +
    `return table.concat(r)end;`;
}

/**
 * Generate bound stub with anti-detection checks
 */
function generateBoundStub(decryptorName, RP, RU, SALT, requirePath, rng) {
  const saltName = `${decryptorName}S`;
  const modwait = generateModuleWait(requirePath);

  // Generate randomized stub
  const checks = generateAntiDebugChecks(RP, RU, modwait, rng);
  const saltComputation = generateSaltComputation(RP, RU, saltName);

  return `local ${saltName}=nil;` +
    `if getgenv==nil then return end;` +
    `pcall(function()local c=string.char;local g=game;` +
    checks +
    saltComputation +
    `end);` +
    `if ${saltName}==nil then return end;` +
    `local ${decryptorName}=function(h,k,q)local r={}for i=1,#h,2 do ` +
    `r[#r+1]=string.char((tonumber(h:sub(i,i+1),16)-k-${saltName}-q*7)%256)end ` +
    `return table.concat(r)end;`;
}

/**
 * Generate module wait code
 */
function generateModuleWait(requirePath) {
  if (!requirePath) return '';

  const comps = requirePath.split('.');
  let code = 'local rq=g;';
  for (const comp of comps) {
    code += `rq=rq and rq[c(${charCode(comp)})];`;
  }
  return code;
}

/**
 * Convert string to char code array
 */
function charCode(str) {
  return str.split('').map(c => c.charCodeAt(0)).join(',');
}

/**
 * Generate anti-debug checks
 */
function generateAntiDebugChecks(RP, RU, modwait, rng) {
  const checks = [];

  // Check for executor
  checks.push('local P=g[c(80,108,97,99,101,73,100)];');
  checks.push(`if(P%${MODULUS_251})~=${RP} then return end;`);

  // Get Players service
  checks.push('local Ps=g:GetService(c(80,108,97,121,101,114,115));');
  checks.push('local LP=Ps[c(76,111,99,97,108,80,108,97,121,101,114)];');
  checks.push('local U=LP[c(85,115,101,114,73,100)];');
  checks.push('if type(U)~=c(110,117,109,98,101,114) then return end;');

  // UserId check if bound
  if (RU >= 0) {
    checks.push(`if(${RU}>=0 and(U%${MODULUS_251})~=${RU})then return end;`);
  }

  // Character detection loop
  checks.push('local ok=false;for i=1,' + ANTI_DEBUG_LOOP_COUNT + ' do ');
  checks.push('local ch=LP[c(67,104,97,114,97,99,116,101,114)];');
  checks.push('local rt=ch and ch:FindFirstChild(c(72,117,109,97,110,111,105,100,82,111,111,116,80,97,114,116));');
  checks.push(modwait);
  checks.push(modwait ? 'if rt and rq then ok=true;break end;' : 'if rt then ok=true;break end;');
  checks.push(`task.wait(${ANTI_DEBUG_LOOP_DELAY_MS}) end;`);
  checks.push('if not ok then return end;');

  // Engine fidelity checks
  checks.push('local V=Vector3.new(3,4,0);');
  checks.push(`if math.abs(V[c(77,97,103,110,105,116,117,100,101)]-5)>${TOLERANCE_VECTOR3} then return end;`);

  checks.push('local CP=(CFrame.new()*CFrame.new(1,2,3))[c(80,111,115,105,116,105,111,110)];');
  checks.push(`if math.abs(CP[c(88)]-1)>${TOLERANCE_CFRAME} or math.abs(CP[c(89)]-2)>${TOLERANCE_CFRAME} or math.abs(CP[c(90)]-3)>${TOLERANCE_CFRAME} then return end;`);

  checks.push('local UD=UDim2.new(0,5,0,7);');
  checks.push('if UD[c(88)][c(79,102,102,115,101,116)]~=5 or UD[c(89)][c(79,102,102,115,101,116)]~=7 then return end;');

  checks.push('if typeof(Color3.new(1,0,0))~=c(67,111,108,111,114,51) then return end;');
  checks.push('if Enum[c(69,97,115,105,110,103,83,116,121,108,101)][c(81,117,97,100)]==nil then return end;');

  // Arithmetic sanity check
  checks.push(`local acc=0;for j=1,${ANTI_DEBUG_ACCUMULATION_MAX} do acc=acc+j end;`);
  checks.push(`if acc~=${ANTI_DEBUG_ACCUMULATION_EXPECTED} then return end;`);

  // Time sanity check
  checks.push('local t1=os.clock();local t2=os.clock();');
  checks.push('if t2<t1 then return end;');

  return checks.join('');
}

/**
 * Generate salt computation
 */
function generateSaltComputation(RP, RU, saltName) {
  return `${saltName}=(P%${MODULUS_251}+(${RU}>=0 and(U*13)%${MODULUS_251} or 0))%${MODULUS_256} end);`;
}

/**
 * Generate junk locals for padding
 */
export function generateJunkLocals(prefix, count, rng) {
  let junk = '';
  for (let j = 0; j < count; j++) {
    junk += `local ${prefix}J${j}=(${rng.nextInt(10000)}+${rng.nextInt(10000)});`;
  }
  return junk;
}

/**
 * Generate decoy secrets
 */
export function generateDecoys(prefix, count, encryptFn, rng) {
  const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const HEXC = '0123456789abcdef';
  const DIGC = '0123456789';

  function rstr(set, len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += set.charAt(rng.nextInt(set.length));
    }
    return s;
  }

  function fakeSecret(mode) {
    if (mode === 0) return `https://discord.com/api/webhooks/${rstr(DIGC, 19)}/${rstr(B64C, 68)}`;
    if (mode === 1) return `https://gist.githubusercontent.com/Cerberuxz/${rstr(HEXC, 32)}/raw/Loader`;
    if (mode === 2) return `https://api.project-reverse.org/run/${rstr(B64C, 64)}`;
    return `https://cdn.payload-hub.com/v2/blob/${rstr(HEXC, 40)}?token=${rstr(B64C, 32)}`;
  }

  let decoyOut = '';
  for (let di = 0; di < count; di++) {
    const secret = fakeSecret(di % 4);
    const encrypted = encryptFn(utf8Encode(secret));
    decoyOut += `local ${prefix}X${di}=(${prefix}D("${encrypted[0]}",${encrypted[1]},${encrypted[2]}));`;
  }

  return decoyOut;
}
