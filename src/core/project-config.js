/**
 * src/core/project-config.js
 *
 * Shell-side reader for .tncproject binary files.
 * NO crypto code — shell only reads the plaintext roomId prefix,
 * then sends the raw file to the server for decryption.
 *
 * File layout (written by server):
 *   [4  bytes] "TNCP" magic
 *   [1  byte]  version 0x01
 *   [24 bytes] roomId ASCII hex  ← only readable part
 *   [12 bytes] AES-GCM IV        ← opaque
 *   [16 bytes] AES-GCM auth tag  ← opaque
 *   [N  bytes] encrypted payload ← opaque
 */

const fs   = require('fs-extra');
const path = require('path');
const os   = require('os');

const CONFIG_FILE  = 'tncproject';
const MAGIC        = Buffer.from('TNCP');
const ROOM_ID_SIZE = 24;
const MIN_SIZE     = 4 + 1 + ROOM_ID_SIZE + 12 + 16 + 2;  // 59 bytes minimum

function findConfigFile(startDir = process.cwd()) {
    let dir    = path.resolve(startDir);
    const root = path.parse(dir).root;

    while (true) {
        const candidate = path.join(dir, CONFIG_FILE);
        if (fs.existsSync(candidate)) return candidate;
        if (dir === root || dir === os.homedir()) break;
        dir = path.dirname(dir);
    }
    return null;
}

/**
 * Read and lightly validate a .tncproject file.
 * Returns { filePath, roomId, fileBase64 } — no decryption.
 *
 * @throws if file is missing, wrong format, or roomId looks wrong
 */
function loadProjectConfig(startDir = process.cwd()) {
    const filePath = findConfigFile(startDir);

    if (!filePath) {
        throw new Error(
            'No .tncproject file found in this directory or any parent.\n' +
            '  Download it from: ThinkNCollab → Room → Project Config'
        );
    }

    const buf = fs.readFileSync(filePath);

    if (buf.length < MIN_SIZE) {
        throw new Error(
            'Invalid .tncproject — file too small or corrupted.\n' +
            '  Re-download it from the dashboard.'
        );
    }

    if (!buf.slice(0, 4).equals(MAGIC)) {
        throw new Error(
            'Not a ThinkNCollab project config file.\n' +
            '  Re-download from the dashboard.'
        );
    }

    const version = buf.readUInt8(4);
    if (version !== 0x01) {
        throw new Error(
            `Unsupported .tncproject version (${version}).\n` +
            '  Update thinkncollab-shell: npm update -g thinkncollab-shell'
        );
    }

    // Read roomId from plaintext prefix — bytes 5..28
    const roomId = buf.slice(5, 5 + ROOM_ID_SIZE).toString('ascii').trim();

    if (!/^[a-f0-9]{24}$/i.test(roomId)) {
        throw new Error(
            'Corrupted .tncproject — invalid roomId.\n' +
            '  Re-download it from the dashboard.'
        );
    }

    return {
        filePath,
        roomId,
        fileBase64: buf.toString('base64'),   // sent as-is to server
    };
}

function hasProjectConfig(startDir = process.cwd()) {
    return !!findConfigFile(startDir);
}

module.exports = { loadProjectConfig, hasProjectConfig, CONFIG_FILE };