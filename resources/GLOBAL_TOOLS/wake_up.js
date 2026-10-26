// 拾光课程表适配 Wakeup 课表分享口令
// 目前采用v6.1.70 官渠apk中 提取到的apk签名md5与signA算法
// signA二次发送至antispam 取signB

const WAKEUP_V6170 = Object.freeze({
    host: "https://api.wakeup.fun",
    antispamPath: "/pluto/app/antispam",
    sharePath: "/share_schedule/getv2",
    packageName: "com.suda.yzune.wakeupschedule",
    versionName: "6.1.70",
    versionCode: 450,
    channel: "100271a",
    publicToken: "1_XPXQH3c5HRPtFHkSwi3sCCURmT25QfxM",
    signatureMd5: "318c6d4f74655d4f032fb0466bcfdfbc",
    magic: "8&%d*",
    signAKey: "@fG2SuLA",
    keySalt: "@#AIjd83#@6B"
});

const WAKEUP_DEVICE_DEFAULTS = Object.freeze({
    androidId: "0000000000000000",
    sdk: "35",
    device: "Pixel 7",
    brand: "google",
    screensize: "1080x2400",
    abis: "arm64-v8a",
    appBit: "64",
    appId: "wakeup",
    downloadType: "1",
    nt: "wifi",
    province: "",
    city: "",
    area: "",
    deviceId: "",
    operatorid: "",
    adid: "",
    did: ""
});

/**
 * 验证用户输入。WakeUP v6.1.70 的分享口令可包含字母、数字、下划线和短横线。
 * @param {string} input 用户输入的原始文本
 * @returns {false|string} 验证成功返回 false，否则返回错误信息。
 */
function validateKey(input) {
    const key = extractKeyFromText(input);
    if (!key) return "输入不能为空！";
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(key)) {
        return "未检测到有效的 WakeUP 分享口令，请粘贴完整分享文本或口令。";
    }
    return false;
}

/**
 * 节次与周次合并去重函数
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 1. 深拷贝并规范周次数据，过滤无效项
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录
    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
               (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];

        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            // 节次连续：延长结束节次
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            // 完全重复：跳过
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    // 阶段 2：合并同节次的周次
    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];

        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            // 周次合并去重
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

/**
 * 从 WakeUP 的标准分享文案或裸口令中提取分享口令。
 * 规则与 WakeUP v6.1.70 官方渠道一致，兼容旧版 32 位十六进制口令。
 */
function extractKeyFromText(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";

    const labelled = text.match(/分享口令(?:为)?\s*[「“"]?\s*([A-Za-z0-9_-]{1,200})\s*[」”"]?/u);
    if (labelled) return labelled[1];

    const quoted = text.match(/[「“"]\s*([A-Za-z0-9_-]{8,200})\s*[」”"]/u);
    if (quoted) return quoted[1];

    const candidates = text.match(/[A-Za-z0-9_-]{8,200}/g);
    return candidates ? candidates[candidates.length - 1] : text;
}

/** WakeUP 协议的浏览器字节、Base64 与 Android quote_plus 兼容工具。 */
function wakeupToBytes(input) {
    return typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
}

function wakeupBytesToBinary(bytes) {
    const source = wakeupToBytes(bytes);
    let output = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < source.length; index += chunkSize) {
        output += String.fromCharCode.apply(null, source.subarray(index, index + chunkSize));
    }
    return output;
}

function wakeupBytesToBase64(bytes) {
    return btoa(wakeupBytesToBinary(bytes));
}

function wakeupBase64ToBytes(text) {
    const binary = atob(text);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
    return output;
}

function wakeupBytesToLatin1(bytes) {
    return wakeupBytesToBinary(bytes);
}

function wakeupBytesToUtf8(bytes) {
    return new TextDecoder("utf-8").decode(wakeupToBytes(bytes));
}

function wakeupAndroidQuote(value) {
    return encodeURIComponent(String(value))
        .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(/%20/g, "+");
}

function wakeupFormEncode(items) {
    return items.map(([key, value]) => `${key}=${wakeupAndroidQuote(value == null ? "" : value)}`).join("&");
}

function wakeupRotateLeft(value, bits) {
    return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/**
 * 纯 JavaScript MD5。Web Crypto 不提供 MD5，故保持适配脚本不依赖 Node 或第三方库。
 * 输入按 UTF-8 字节计算，与 WakeUP 官方协议中的 native/Java 实现对齐。
 */
function wakeupMd5Bytes(input) {
    const source = wakeupToBytes(input);
    const paddedLength = (((source.length + 8) >>> 6) + 1) * 64;
    const data = new Uint8Array(paddedLength);
    data.set(source);
    data[source.length] = 0x80;

    const bitLength = source.length * 8;
    for (let index = 0; index < 8; index += 1) {
        data[paddedLength - 8 + index] = Math.floor(bitLength / Math.pow(256, index)) & 0xff;
    }

    const shifts = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < data.length; offset += 64) {
        const words = new Uint32Array(16);
        for (let index = 0; index < 16; index += 1) {
            const wordOffset = offset + index * 4;
            words[index] = (data[wordOffset] | (data[wordOffset + 1] << 8) |
                (data[wordOffset + 2] << 16) | (data[wordOffset + 3] << 24)) >>> 0;
        }

        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;
        for (let index = 0; index < 64; index += 1) {
            let f;
            let g;
            if (index < 16) {
                f = (b & c) | ((~b) & d);
                g = index;
            } else if (index < 32) {
                f = (d & b) | ((~d) & c);
                g = (5 * index + 1) % 16;
            } else if (index < 48) {
                f = b ^ c ^ d;
                g = (3 * index + 5) % 16;
            } else {
                f = c ^ (b | (~d));
                g = (7 * index) % 16;
            }
            const next = d;
            d = c;
            c = b;
            b = (b + wakeupRotateLeft((a + f + constants[index] + words[g]) >>> 0, shifts[index])) >>> 0;
            a = next;
        }
        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
    }

    const digest = new Uint8Array(16);
    const view = new DataView(digest.buffer);
    view.setUint32(0, a0, true);
    view.setUint32(4, b0, true);
    view.setUint32(8, c0, true);
    view.setUint32(12, d0, true);
    return digest;
}

function wakeupMd5Hex(input) {
    return Array.from(wakeupMd5Bytes(input), byte => byte.toString(16).padStart(2, "0")).join("");
}

function wakeupMd5Upper(input) {
    return wakeupMd5Hex(input).toUpperCase();
}

// 以下表与位序来自 WakeUP v6.1.70 官方协议。该私有 DES 并非标准 DES，禁止替换。
const WAKEUP_DES_IP = [57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7, 56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6];
const WAKEUP_DES_FP = [39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25, 32, 0, 40, 8, 48, 16, 56, 24];
const WAKEUP_DES_E = [31, 0, 1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 7, 8, 9, 10, 11, 12, 11, 12, 13, 14, 15, 16, 15, 16, 17, 18, 19, 20, 19, 20, 21, 22, 23, 24, 23, 24, 25, 26, 27, 28, 27, 28, 29, 30, 31, 0];
const WAKEUP_DES_P = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24];
const WAKEUP_DES_PC1 = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
const WAKEUP_DES_PC2 = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 46, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];
const WAKEUP_DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const WAKEUP_DES_SBOX = [
    [[14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7],[0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8],[4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0],[15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13]],
    [[15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10],[3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5],[0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15],[13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9]],
    [[10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8],[13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1],[13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7],[1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12]],
    [[7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15],[13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9],[10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4],[3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14]],
    [[2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9],[14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6],[4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14],[11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3]],
    [[12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11],[10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8],[9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6],[4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13]],
    [[4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1],[13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6],[1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2],[6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12]],
    [[13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7],[1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2],[7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8],[2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]]
];

function wakeupDesBitsFromBytes(bytes) {
    const output = new Array(bytes.length * 8);
    for (let index = 0; index < bytes.length; index += 1) {
        for (let bit = 0; bit < 8; bit += 1) output[index * 8 + bit] = (bytes[index] >> bit) & 1;
    }
    return output;
}

function wakeupDesBytesFromBits(bits) {
    const output = new Uint8Array(bits.length / 8);
    for (let index = 0; index < output.length; index += 1) {
        for (let bit = 0; bit < 8; bit += 1) output[index] |= (bits[index * 8 + bit] & 1) << bit;
    }
    return output;
}

function wakeupDesPermute(bits, table) {
    return table.map(index => bits[index] | 0);
}

function wakeupDesSubkeys(key) {
    const keyBytes = wakeupToBytes(key);
    if (keyBytes.length !== 8) throw new Error("WakeUP 私有 DES 密钥长度必须为 8 字节。");
    const bits = wakeupDesPermute(wakeupDesBitsFromBytes(keyBytes), WAKEUP_DES_PC1);
    let left = bits.slice(0, 28);
    let right = bits.slice(28);
    return WAKEUP_DES_SHIFTS.map(shift => {
        left = left.slice(shift).concat(left.slice(0, shift));
        right = right.slice(shift).concat(right.slice(0, shift));
        return wakeupDesPermute(left.concat(right), WAKEUP_DES_PC2);
    });
}

function wakeupDesFunction(right, subkey) {
    const expanded = wakeupDesPermute(right, WAKEUP_DES_E);
    const mixed = expanded.map((bit, index) => bit ^ subkey[index]);
    const output = [];
    for (let box = 0; box < 8; box += 1) {
        const block = mixed.slice(box * 6, box * 6 + 6);
        const row = block[0] * 2 + block[5];
        const column = block[1] * 8 + block[2] * 4 + block[3] * 2 + block[4];
        const value = WAKEUP_DES_SBOX[box][row][column];
        output.push((value >> 3) & 1, (value >> 2) & 1, (value >> 1) & 1, value & 1);
    }
    return wakeupDesPermute(output, WAKEUP_DES_P);
}

function wakeupDesBlock(block, subkeys) {
    const bits = wakeupDesPermute(wakeupDesBitsFromBytes(block), WAKEUP_DES_IP);
    let left = bits.slice(0, 32);
    let right = bits.slice(32);
    for (const subkey of subkeys) {
        const mixed = wakeupDesFunction(right, subkey);
        const nextRight = left.map((bit, index) => bit ^ mixed[index]);
        left = right;
        right = nextRight;
    }
    return wakeupDesBytesFromBits(wakeupDesPermute(right.concat(left), WAKEUP_DES_FP));
}

function wakeupConcatBytes(chunks) {
    const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
    let offset = 0;
    chunks.forEach(chunk => {
        output.set(chunk, offset);
        offset += chunk.length;
    });
    return output;
}

function wakeupDesEncrypt(plain, key) {
    const source = wakeupToBytes(plain);
    const paddedLength = (source.length & ~7) + 8;
    const padded = new Uint8Array(paddedLength);
    padded.set(source);
    padded[paddedLength - 1] = paddedLength - source.length;
    const subkeys = wakeupDesSubkeys(key);
    const blocks = [];
    for (let offset = 0; offset < paddedLength; offset += 8) blocks.push(wakeupDesBlock(padded.subarray(offset, offset + 8), subkeys));
    return wakeupConcatBytes(blocks);
}

function wakeupDesDecrypt(cipher, key) {
    const source = wakeupToBytes(cipher);
    if (source.length % 8 !== 0) throw new Error("WakeUP 私有 DES 密文长度无效。");
    const subkeys = wakeupDesSubkeys(key).reverse();
    const blocks = [];
    for (let offset = 0; offset < source.length; offset += 8) blocks.push(wakeupDesBlock(source.subarray(offset, offset + 8), subkeys));
    const plain = wakeupConcatBytes(blocks);
    const padLength = plain[plain.length - 1];
    if (padLength > plain.length) throw new Error("WakeUP 私有 DES 填充无效。");
    return plain.subarray(0, plain.length - padLength);
}

function wakeupReverseNibble(value) {
    return ((value & 1) << 3) | ((value & 2) << 1) | ((value & 4) >> 1) | ((value & 8) >> 3);
}

function wakeupNativeHexEncode(bytes) {
    return Array.from(wakeupToBytes(bytes), byte => {
        const low = wakeupReverseNibble(byte & 0x0f).toString(16).padStart(2, "0");
        const high = wakeupReverseNibble((byte >> 4) & 0x0f).toString(16).padStart(2, "0");
        return low + high;
    }).join("");
}

function wakeupNativeHexDecode(text) {
    const source = String(text).slice(0, Math.floor(String(text).length / 4) * 4);
    const output = new Uint8Array(source.length / 4);
    for (let index = 0; index < source.length; index += 4) {
        const low = wakeupReverseNibble(parseInt(source[index + 1], 16));
        const high = wakeupReverseNibble(parseInt(source[index + 3], 16));
        output[index / 4] = low | (high << 4);
    }
    return output;
}

function wakeupRc4(data, key) {
    const keyBytes = wakeupToBytes(key);
    const state = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) state[index] = index;
    let swapIndex = 0;
    for (let index = 0; index < 256; index += 1) {
        swapIndex = (swapIndex + state[index] + keyBytes[index % keyBytes.length]) & 0xff;
        [state[index], state[swapIndex]] = [state[swapIndex], state[index]];
    }
    const input = wakeupToBytes(data);
    const output = new Uint8Array(input.length);
    let left = 0;
    let right = 0;
    for (let index = 0; index < input.length; index += 1) {
        left = (left + 1) & 0xff;
        right = (right + state[left]) & 0xff;
        [state[left], state[right]] = [state[right], state[left]];
        output[index] = input[index] ^ state[(state[left] + state[right]) & 0xff];
    }
    return output;
}

/** WakeUP v6.1.70 的设备标识、签名、反爬握手和加密请求实现。 */
function wakeupCuidFromAndroidId(androidId) {
    return `${wakeupMd5Upper(`com.baidu${androidId || ""}`)}|0`;
}

function wakeupAdidFromAndroidId(androidId) {
    const prefix = wakeupMd5Hex(`alpha.beta${androidId || ""}`);
    const folded = BigInt(`0x${prefix.slice(0, 16)}`) ^ BigInt(`0x${prefix.slice(16)}`);
    const checksum = (((folded >> 32n) ^ folded) & 0xffffffffn).toString(16).padStart(8, "0");
    return prefix + checksum;
}

function wakeupGenerateRand10() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = new Uint8Array(10);
    if (!globalThis.crypto || !globalThis.crypto.getRandomValues) throw new Error("当前 WebView 不支持安全随机数生成。");
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function wakeupCreateDevice() {
    const device = { ...WAKEUP_DEVICE_DEFAULTS };
    device.cuid = wakeupCuidFromAndroidId(device.androidId);
    device.adid = device.adid || wakeupAdidFromAndroidId(device.androidId);
    return device;
}

function wakeupMakeCommonParams(device) {
    return [["area", device.area], ["screensize", device.screensize], ["cuid", device.cuid], ["os", "android"],
        ["city", device.city], ["abis", device.abis], ["channel", WAKEUP_V6170.channel], ["appBit", device.appBit],
        ["vc", String(WAKEUP_V6170.versionCode)], ["deviceId", device.deviceId], ["token", WAKEUP_V6170.publicToken],
        ["adid", device.adid], ["province", device.province], ["pkgName", WAKEUP_V6170.packageName], ["appId", device.appId],
        ["download_type", device.downloadType], ["vcname", WAKEUP_V6170.versionName], ["sdk", String(device.sdk)],
        ["device", device.device], ["brand", device.brand], ["operatorid", device.operatorid]]
        .map(([key, value]) => [key, value == null ? "" : String(value)]);
}

function wakeupMakeSignA(cuid) {
    const rand10 = wakeupGenerateRand10();
    const plain = `${WAKEUP_V6170.magic}##${rand10}##${WAKEUP_V6170.signatureMd5}##${cuid}`;
    return { signA: wakeupNativeHexEncode(wakeupDesEncrypt(plain, WAKEUP_V6170.signAKey)), rand10 };
}

function wakeupTokenFromSignB(signB, rand10) {
    const plain = wakeupDesDecrypt(wakeupNativeHexDecode(signB), `${rand10.slice(0, 5)}#G4`);
    const text = wakeupBytesToLatin1(plain);
    if (text.length < 22 || text.slice(0, 10) !== rand10) throw new Error("WakeUP antispam token 校验失败。");
    return text.slice(12, 22);
}

function wakeupGetRc4Key(token) {
    const first = wakeupMd5Hex(WAKEUP_V6170.keySalt);
    const second = wakeupMd5Hex(String(WAKEUP_V6170.versionCode));
    const raw = wakeupMd5Hex(`[${token}]@`);
    const reversed = raw.slice(17).split("").reverse().join("") + raw.slice(15, 17) + raw.slice(0, 15).split("").reverse().join("");
    const chars = (first + second + reversed).split("");
    for (let index = 0; index < 3; index += 1) {
        const right = chars.length - 1 - index;
        [chars[index], chars[right]] = [chars[right], chars[index]];
    }
    const output = (chars.join("") + wakeupMd5Hex(chars.join(""))).split("");
    for (let index = 0; index < 60; index += 1) {
        [output[index], output[output.length - 1 - index]] = [output[output.length - 1 - index], output[index]];
    }
    return output.join("");
}

function wakeupGetSign(base64Params, token) {
    return wakeupMd5Hex(`${WAKEUP_V6170.magic}[${wakeupMd5Hex(token)}]@${base64Params}`);
}

function wakeupBuildShareRequest(code, token, device, commonParams) {
    const rc4Key = wakeupGetRc4Key(token);
    const dataValue = wakeupBytesToBase64(wakeupRc4(`key=${wakeupAndroidQuote(code)}`, rc4Key));
    const serverTime = Math.floor(Date.now() / 1000);
    const kakorr = Date.now();
    const signItems = [`data=${dataValue}`, ...commonParams.map(([key, value]) => `${key}=${value}`)];
    if (device.did) signItems.push(`did=${device.did}`);
    signItems.push(`nt=${device.nt}`, `_t_=${serverTime}`, `kakorrhaphiophobia=${kakorr}`);
    const sign = wakeupGetSign(wakeupBytesToBase64(new TextEncoder().encode(signItems.sort().join(""))), token);
    const extras = device.did ? [["did", device.did]] : [];
    const body = `&${wakeupFormEncode([["data", dataValue], ...commonParams, ...extras, ["nt", device.nt]])}&sign=${sign}&_t_=${serverTime}&kakorrhaphiophobia=${kakorr}`;
    return { rc4Key, body };
}

function wakeupExtractSignB(payload) {
    if (!payload || typeof payload !== "object") return "";
    let candidate = payload.data;
    if (candidate && typeof candidate === "object") candidate = candidate.data;
    if (typeof candidate !== "string" || !candidate) candidate = payload.result && typeof payload.result === "object" ? payload.result.data : null;
    return typeof candidate === "string" ? candidate : "";
}

async function wakeupPostForm(url, body, device) {
    const headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "na__zyb_source__": "wakeup", "zyb-cuid": device.cuid, "zyb-adid": device.adid };
    if (device.did) headers["zyb-did"] = device.did;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
    try {
        const response = await fetch(url, { method: "POST", headers, body, signal: controller ? controller.signal : undefined });
        const text = await response.text();
        if (!response.ok) throw new Error(`WakeUP 服务请求失败（HTTP ${response.status}）。`);
        return text;
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

/**
 * 执行 WakeUP 官方 v6.1.70 两段式请求，并返回解密后的课表分享数据。
 * 敏感口令、签名和 token 不写入日志，避免泄漏。
 */
async function wakeupDecodeShareCode(code) {
    const device = wakeupCreateDevice();
    const commonParams = wakeupMakeCommonParams(device);
    const { signA, rand10 } = wakeupMakeSignA(device.cuid);
    const antispamBody = `${wakeupFormEncode([["data", signA], ...commonParams])}&`;
    const antispamText = await wakeupPostForm(`${WAKEUP_V6170.host}${WAKEUP_V6170.antispamPath}`, antispamBody, device);
    let antispamJson;
    try {
        antispamJson = JSON.parse(antispamText);
    } catch {
        throw new Error("WakeUP antispam 响应格式无效。");
    }
    const signB = wakeupExtractSignB(antispamJson);
    if (!signB) throw new Error("WakeUP antispam 响应未包含签名数据。");

    const token = wakeupTokenFromSignB(signB, rand10);
    const shareRequest = wakeupBuildShareRequest(code, token, device, commonParams);
    const shareText = await wakeupPostForm(`${WAKEUP_V6170.host}${WAKEUP_V6170.sharePath}`, shareRequest.body, device);
    let shareJson;
    try {
        shareJson = JSON.parse(shareText);
    } catch {
        throw new Error("WakeUP 课表响应格式无效。");
    }

    const encrypted = shareJson && typeof shareJson.data === "object" ? shareJson.data.data : shareJson && shareJson.data;
    if (typeof encrypted !== "string" || !encrypted) throw new Error("WakeUP 课表响应未包含加密数据。");
    let decrypted;
    try {
        decrypted = JSON.parse(wakeupBytesToUtf8(wakeupRc4(wakeupBase64ToBytes(encrypted), shareRequest.rc4Key)));
    } catch {
        throw new Error("WakeUP 课表响应解密失败。");
    }
    if (!decrypted || typeof decrypted.shareData !== "string") throw new Error("WakeUP 解密数据中未找到 shareData。");
    return decrypted.shareData;
}

/** 将 WakeUP 分享数据（多个换行分隔的 JSON 块）解析成各部分。 */
function parseRawScheduleData(rawData) {
    window.shiguangBridge.showToast("正在解析原始数据...");
    const parts = rawData.trim().split("\n");
    if (parts.length < 5) throw new Error("数据格式不完整，预期至少包含 5 个部分。");
    return {
        baseConfig: JSON.parse(parts[0]),
        timeSlotsRaw: JSON.parse(parts[1]),
        uiConfig: JSON.parse(parts[2]),
        coursesRaw: JSON.parse(parts[3]),
        courseDetailRaw: JSON.parse(parts[4])
    };
}

function formatDateToYYYYMMDD(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function convertToSemesterStartDate(rawDate) {
    if (!rawDate || String(rawDate).trim().length === 0) return null;
    const dateObj = new Date(String(rawDate).trim().replace(/\//g, "-"));
    if (isNaN(dateObj.getTime())) {
        console.warn(`WARN: 无法将原始日期值 "${rawDate}" 转换为有效日期。`);
        return null;
    }
    return formatDateToYYYYMMDD(dateObj);
}

/** 通过 WakeUP v6.1.70 官方渠道获取、解密、解析并转换课程表。 */
async function fetchAndParseData(shareKey) {
    try {
        window.shiguangBridge.showToast("正在通过 WakeUP 官方渠道请求课表数据...");
        const parsedData = parseRawScheduleData(await wakeupDecodeShareCode(shareKey.trim()));
        let rawNodes = parsedData.uiConfig.nodes;
        if (!Array.isArray(rawNodes)) {
            if (typeof rawNodes === "number" && rawNodes > 0) {
                rawNodes = Array.from({ length: rawNodes }, (_, index) => index + 1);
            } else {
                console.warn(`WARN: uiConfig.nodes 数据无效 (${rawNodes})，已重置为空数组。`);
                rawNodes = [];
            }
        }

        const validNodes = new Set(rawNodes);
        const timeSlots = parsedData.timeSlotsRaw
            .filter(slot => slot.startTime !== "00:00" && slot.endTime !== "00:00")
            .filter(slot => validNodes.has(slot.node))
            .map(slot => ({ number: slot.node, startTime: slot.startTime, endTime: slot.endTime }));
        const courseConfig = {
            semesterStartDate: convertToSemesterStartDate(parsedData.uiConfig.startDate),
            semesterTotalWeeks: parsedData.uiConfig.maxWeek,
            defaultClassDuration: parsedData.baseConfig.courseLen,
            defaultBreakDuration: parsedData.baseConfig.theBreakLen
        };
        const courses = convertToCourseJsonModel(parsedData);
        window.shiguangBridge.showToast(`数据解析成功，共 ${courses.length} 门课程`);
        return { timeSlots, courseConfig, courses };
    } catch (error) {
        console.error("WakeUP 数据获取或解析失败:", error);
        window.shiguangBridge.showToast(`数据获取或解析失败: ${error.message}`);
        return null;
    }
}

/**
 * 将课程数据从原始结构转换为 CourseJsonModel 格式。
 * @param {object} parsedData 包含 coursesRaw 和 courseDetailRaw 的解析数据。
 * @returns {Array<object>} 符合 CourseJsonModel 结构的课程数组。
 */
function convertToCourseJsonModel(parsedData) {
    const { coursesRaw, courseDetailRaw } = parsedData;
    const finalCourses = [];

    // 创建课程ID到课程信息的映射
    const courseMap = coursesRaw.reduce((map, course) => {
        map[course.id] = course;
        return map;
    }, {});

    // 遍历课程安排详情，构建最终的 CourseJsonModel
    courseDetailRaw.forEach(detail => {
        if (detail.id === undefined || detail.id === null) return;
        
        const courseInfo = courseMap[detail.id];
        if (!courseInfo) return; 

        // 计算 weeks 数组
        const weeks = [];
        for (let i = detail.startWeek; i <= detail.endWeek; i++) {
            if (detail.type === 0 || // 每周
                (detail.type === 1 && i % 2 !== 0) || // 单周 (奇数周)
                (detail.type === 2 && i % 2 === 0)) { // 双周 (偶数周)
                weeks.push(i);
            }
        }
        
        // 构造 CourseJsonModel 对象
        const course = {
            "name": courseInfo.courseName, 
            "teacher": detail.teacher || "",
            "position": detail.room || "",
            "day": detail.day, 
            "weeks": weeks
        };

        // 处理自定义时间 (ownTime)
        if (detail.ownTime === true && detail.startTime && detail.endTime) {
            // 使用自定义时间
            course.isCustomTime = true;
            course.customStartTime = detail.startTime;
            course.customEndTime = detail.endTime;
        } else {
            // 使用标准节次
            course.startSection = detail.startNode;
            course.endSection = detail.startNode + detail.step - 1;
        }

        finalCourses.push(course);
    });

    // 应用合并去重
    return mergeAndDistinctCourses(finalCourses);
}



async function saveTimeSlots(timeSlots) {
    if (timeSlots.length === 0) {
        window.shiguangBridge.showToast("没有可导入的时间段数据。");
        return true;
    }
    try {
        console.log("正在导入时间段...");
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast(`成功导入 ${timeSlots.length} 个时间段！`);
        return true;
    } catch (error) {
        console.error("导入时间段失败:", error);
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        return false;
    }
}

async function saveConfig(configData) {
    try {
        console.log("正在导入课表配置...");
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
        window.shiguangBridge.showToast("课表配置（学期/时长）更新成功！");
        return true;
    } catch (error) {
        console.error("导入配置失败:", error);
        window.shiguangBridge.showToast("导入配置失败: " + error.message);
        return false;
    }
}

async function saveCourses(courses) {
    if (courses.length === 0) {
        window.shiguangBridge.showToast("没有课程数据需要导入。");
        return true;
    }
    try {
        console.log("正在导入课程数据...");
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        return true;
    } catch (error) {
        console.error("导入课程失败:", error);
        window.shiguangBridge.showToast("导入课程失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    console.log("Wakeup 课表分享导入流程启动...");
    window.shiguangBridge.showToast("课表导入流程即将开始...");

    // 获取用户输入
    const userInput = await window.shiguangBridgePromise.showPrompt(
        "输入课表分享口令",
        "可直接粘贴分享的整段文本，系统会自动提取 Key",
        "",
        "validateKey"
    );
    if (userInput === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    //  提取口令（从「」内或文本特征中提取 32 位 Key）
    const shareKey = extractKeyFromText(userInput);

    // 网络请求和数据解析
    const parsed = await fetchAndParseData(shareKey);
    if (parsed === null) {
        return;
    }

    // 导入时间段
    const timeSlotResult = await saveTimeSlots(parsed.timeSlots);
    if (!timeSlotResult) {
        return;
    }

    // 导入配置
    const configResult = await saveConfig(parsed.courseConfig);
    if (!configResult) {
        return;
    }
    
    // 导入课程数据
    const courseSaveResult = await saveCourses(parsed.courses);
    if (!courseSaveResult) {
        return;
    }

    // 流程完全成功，发送结束信号
    window.shiguangBridge.showToast("所有任务已成功完成！");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();