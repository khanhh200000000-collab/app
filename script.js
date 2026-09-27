const avatarBtn = document.getElementById('userAvatar');
const panel = document.getElementById('userInfoPanel');

if (avatarBtn && panel) {
    avatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('show');
    });

    document.addEventListener('click', () => {
        panel.classList.remove('show');
    });

    panel.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

function updateTime() {
    const liveTime = document.getElementById('live-time');
    if (!liveTime) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN');
    const dateStr = now.toLocaleDateString('vi-VN');
    liveTime.textContent = `${dateStr} ${timeStr}`;
}
updateTime();
setInterval(updateTime, 1000);

const FIRMWARE_ENDPOINT = './firmware';
const espInstallWrap = document.getElementById('espInstallWrap');
const espInstallButton = document.getElementById('espInstallButton');
const espInstallError = document.getElementById('espInstallError');
const ESP32_MANIFEST_PATH = './firmware/ESP32/manifest.json';
const ESP32_GITHUB_BIN = 'https://raw.githubusercontent.com/khanhh200000000-collab/app/main/firmware/ESP32/beechat.bin';

const FIRMWARE_IDS = {
    FLASHLOADER: './firmware/imgtool_flashloader_amebad.bin',
    KM0: './firmware/km0_boot_all.bin',
    KM4: './firmware/km4_boot_all.bin',
    BW16: './firmware/BW16/km0_km4_image2.bin',
    ESP32: ESP32_GITHUB_BIN
};

async function loadFirmwareById(pathOrId) {
    const url = `${pathOrId}?t=${Date.now()}`.replace(/\?t=.*$/, `?t=${Date.now()}`);
    const response = await fetch(pathOrId, {
        method: 'GET',
        cache: 'no-store',
        headers: {
            'Accept': 'application/octet-stream'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to load firmware ${pathOrId}`);
    }

    return new Uint8Array(await response.arrayBuffer());
}

let selectedFirmware = null;
let selectedFirmwareType = null;
let systemFirmwareCache = {
    FLASHLOADER: null,
    KM0: null,
    KM4: null
};
let port = null;
let writer = null;
let reader = null;
let keepReading = false;
let inputChunks = [];
let inputBufferTotalLen = 0;

const RET_SUCCESS = 0x06;
const RET_SYNC = 0x15;
const RAM_LOADER_ADDR = 0x082000;

const SPEED_MAP = {
    1500000: 0x18, 1444400: 0x17, 1382400: 0x16, 1000000: 0x15,
    921600:  0x14, 500000:  0x13, 460800:  0x12, 380400:  0x11,
    230400:  0x10, 153600:  0x0F, 128000:  0x0D, 115200:  0x0C
};

const connectBtn = document.getElementById('connectBtn');
const flashBtn = document.getElementById('flashBtn');
const eraseBtn = document.getElementById('eraseBtn');
const logArea = document.getElementById('logArea');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressText = document.getElementById('progressText');
const connectionStatus = document.getElementById('connectionStatus');

const statusConnection = document.getElementById('statusConnection');
const statusFlashMode = document.getElementById('statusFlashMode');
const statusOperation = document.getElementById('statusOperation');
const statusSpeed = document.getElementById('statusSpeed');

async function loadSystemFirmware() {
    try {
        log('SYSTEM', 'Loading system components...');
        setProgress(10, '[LOADING_SYSTEM]');

        log('SYSTEM', 'Loading Flashloader...');
        systemFirmwareCache.FLASHLOADER = await loadFirmwareById(FIRMWARE_IDS.FLASHLOADER);
        setProgress(30, '[FLASHLOADER_LOADED]');

        log('SYSTEM', 'Loading KM0 Bootloader...');
        systemFirmwareCache.KM0 = await loadFirmwareById(FIRMWARE_IDS.KM0);
        setProgress(50, '[KM0_LOADED]');

        log('SYSTEM', 'Loading KM4 Bootloader...');
        systemFirmwareCache.KM4 = await loadFirmwareById(FIRMWARE_IDS.KM4);
        setProgress(70, '[KM4_LOADED]');

        const appPromises = [
            checkFirmwareExists(FIRMWARE_IDS.BW16),
            checkFirmwareExists(FIRMWARE_IDS.ESP32)
        ];

        const results = await Promise.allSettled(appPromises);
        const availableApps = results.filter(r => r.status === 'fulfilled' && r.value).length;

        setProgress(100, '[SYSTEM_READY]');
        log('SUCCESS', `System ready. ${availableApps} firmware images available.`);

        flashBtn.disabled = false;
        eraseBtn.disabled = false;

    } catch (error) {
        log('ERROR', `System error: ${error.message}`);
        alert('[ERROR] Failed to load system firmware.');
    }
}

async function checkFirmwareExists(pathOrId) {
    try {
        const response = await fetch(pathOrId, { method: 'HEAD' });
        return response.ok;
    } catch {
        return false;
    }
}

async function loadApplicationFirmware(type) {
    let url, name;
    switch(type) {
        case 'BW16':
            url = FIRMWARE_IDS.BW16;
            name = 'BW16';
            break;
        case 'ESP32':
            url = FIRMWARE_IDS.ESP32;
            name = 'ESP32';
            break;
        default:
            throw new Error(`Unknown firmware type: ${type}`);
    }

    const id = FIRMWARE_IDS[type];
    if (!id) throw new Error(`Unknown firmware type: ${type}`);

    const statusElement = document.getElementById('firmwareStatus');
    statusElement.classList.remove('hidden');
    statusElement.classList.add('border-green-500');
    statusElement.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>LOADING...';

    try {
        log('SYSTEM', `Loading ${name}...`);

        const data = await loadFirmwareById(id);

        statusElement.classList.remove('border-green-500');
        statusElement.classList.add('border-green-700');
        statusElement.innerHTML = '<i class="fas fa-check mr-1"></i>LOADED';

        log('SUCCESS', `${name} loaded (${(data.length / 1024).toFixed(1)} KB)`);

        const fwSize = document.getElementById('fwSize');
        if (fwSize) {
            fwSize.textContent = `${(data.length / 1024).toFixed(1)}KB`;
        }

        return data;

    } catch (error) {
        statusElement.classList.remove('border-green-500');
        statusElement.classList.add('border-red-500');
        statusElement.innerHTML = '<i class="fas fa-times mr-1"></i>FAILED';

        log('ERROR', `Failed to load firmware ${name}: ${error.message}`);

        const fwSize = document.getElementById('fwSize');
        if (fwSize) {
            fwSize.textContent = 'FAILED';
        }

        throw error;
    }
}

function clearLog() {
    logArea.innerHTML = `<span class="text-green-500">╔══════════════════════════════════════════════════╗</span>
<span class="text-green-500">║                OPERATION CONSOLE                ║</span>
<span class="text-green-500">╚══════════════════════════════════════════════════╝</span>

<span class="text-cyan-400">[SYSTEM]</span> Console cleared
<span class="text-green-400">[READY]</span> Awaiting operations
<span class="terminal-cursor"></span>`;
    log('SYSTEM', 'Console cleared');
}

function exportLog() {
    const logContent = logArea.textContent;
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `amebad-flash-${new Date().toISOString().slice(0,10)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('SYSTEM', 'Log exported');
}

function copyLog() {
    const logContent = logArea.textContent;
    navigator.clipboard.writeText(logContent).then(() => {
        log('SYSTEM', 'Log copied');
    }).catch(err => {
        log('ERROR', 'Copy failed');
    });
}

async function applyEspInstallButtonStyle() {
    if (!espInstallButton) return;

    try {
        if (customElements && !customElements.get('esp-web-install-button')) {
            await customElements.whenDefined('esp-web-install-button');
        }

        espInstallButton.style.setProperty('--esp-web-tools-button-color', '#00f5ff');
        espInstallButton.style.setProperty('--esp-web-tools-button-text-color', '#00131a');
        espInstallButton.style.setProperty('--esp-web-tools-button-border-radius', '0px');
        espInstallButton.style.setProperty('--esp-web-tools-button-padding', '0.95rem 1.4rem');
        espInstallButton.style.setProperty('--esp-web-tools-button-font-size', '0.78rem');
        espInstallButton.style.setProperty('--esp-web-tools-button-font-weight', '800');
        espInstallButton.style.setProperty('--esp-web-tools-button-box-shadow', '0 0 0 2px rgba(0, 255, 255, 0.12), 0 0 18px rgba(0, 255, 255, 0.32), 0 0 18px rgba(255, 0, 255, 0.22)');
        espInstallButton.style.setProperty('--esp-web-tools-button-border-color', 'rgba(0, 255, 255, 0.9)');
        espInstallButton.style.setProperty('--esp-web-tools-button-background-color', 'linear-gradient(135deg, #00ffff 0%, #7afcff 30%, #00d4ff 50%, #ff4df7 100%)');

        const shadowButton = espInstallButton.shadowRoot?.querySelector('button');
        if (shadowButton) {
            shadowButton.innerHTML = '<i class="fas fa-plug mr-2"></i> INSTALL';
            shadowButton.style.borderRadius = '0';
            shadowButton.style.border = '2px solid rgba(0, 255, 255, 0.9)';
            shadowButton.style.background = 'linear-gradient(135deg, #00ffff 0%, #7afcff 30%, #00d4ff 50%, #ff4df7 100%)';
            shadowButton.style.color = '#00131a';
            shadowButton.style.fontFamily = '"Source Code Pro", monospace';
            shadowButton.style.textTransform = 'uppercase';
            shadowButton.style.letterSpacing = '1.2px';
            shadowButton.style.fontWeight = '800';
            shadowButton.style.padding = '0.7rem 1rem';
            shadowButton.style.minWidth = '190px';
            shadowButton.style.width = 'fit-content';
            shadowButton.style.display = 'inline-flex';
            shadowButton.style.alignItems = 'center';
            shadowButton.style.justifyContent = 'center';
            shadowButton.style.boxShadow = '0 0 0 2px rgba(0, 255, 255, 0.12), 0 0 18px rgba(0, 255, 255, 0.32), 0 0 18px rgba(255, 0, 255, 0.22)';
            shadowButton.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease';
        }
    } catch (error) {
        console.warn('ESP32 button style fallback failed:', error);
    }
}

async function ensureEsp32InstallReady() {
    if (!espInstallButton || !espInstallWrap || !espInstallError) return false;

    try {
        const manifestRes = await fetch(ESP32_MANIFEST_PATH, { cache: 'no-store' });
        if (!manifestRes.ok) throw new Error('manifest not found');

        const manifest = await manifestRes.json();
        const buildParts = (manifest.builds || []).flatMap(build => build.parts || []);
        const binPaths = buildParts.map(part => part.path).filter(Boolean);

        if (!binPaths.length) throw new Error('manifest has no firmware binary');

        const checks = await Promise.all(binPaths.map(async (binPath) => {
            const res = await fetch(binPath, { method: 'HEAD', cache: 'no-store' });
            return res.ok ? binPath : null;
        }));

        const foundBin = checks.find(Boolean);
        if (!foundBin) throw new Error('firmware binary missing');

        espInstallButton.setAttribute('manifest', ESP32_MANIFEST_PATH);
        espInstallButton.style.display = 'inline-block';
        espInstallError.classList.add('hidden');
        espInstallWrap.classList.remove('hidden');

        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 30)));
        await applyEspInstallButtonStyle();
        return true;
    } catch (error) {
        espInstallButton.style.display = 'none';
        espInstallActionState = 'missing';
        espInstallError.classList.remove('hidden');
        espInstallWrap.classList.remove('hidden');
        log('ERROR', `ESP32 install unavailable: ${error.message}`);
        return false;
    }
}

function renderDeviceDetails(type) {
    const panel = document.getElementById('deviceDetailPanel');
    const image = document.getElementById('deviceImage');
    const tableBody = document.querySelector('#deviceSpecTable tbody');
    const guide = document.getElementById('deviceGuide');

    if (!panel || !tableBody || !guide || !image) return;

    const details = {
        BW16: {
            image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80',
            purpose: 'Firmware BW16 chủ yếu dùng cho board Realtek RTL8720DN với chức năng chính là deauth WiFi 2.4GHz và 5GHz, plus chế độ Evil AP / Evil Twin để thao túng hoặc đánh lạc hướng mạng WiFi mục tiêu. Đây là firmware tập trung vào tấn công và kiểm thử WiFi theo hướng deauth / evil.',
            specs: [
                ['THIẾT BỊ', 'BW16 / RTL8720DN'],
                ['CHIP', 'Realtek AmebaD / RTL8720DN'],
                ['KẾT NỐI', 'USB UART / BOOT MODE'],
                ['CHẾ ĐỘ', 'Firmware flash bằng serial + reset'],
                ['CHỨC NĂNG CHÍNH', 'Deauth 2.4GHz / 5GHz / Evil AP'],
                ['MỤC ĐÍCH', 'Dùng cho BW16 để thực hiện deauth và evil WiFi trên mạng mục tiêu']
            ],
            steps: [
                'Nối board BW16 vào máy tính qua cổng USB.',
                'Nhấn và giữ nút BOOT hoặc giữ chân reset theo board.',
                'Chọn firmware BW16 rồi bấm FLASH để tải file.',
                'Sau khi hoàn tất, bỏ BOOT và kiểm tra chức năng deauth / evil trên console.'
            ]
        },
        ESP32: {
            image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80',
            purpose: 'Firmware Beechat Zero dùng 2 chip ESP32 và BW16, kết hợp chức năng chat mesh, LoRa, BLE, GPS, nRF24, game app, và các ứng dụng mạng mesh. Đây là phiên bản tích hợp đa chức năng cho hệ thống giao tiếp giữa các trạm và thiết bị ngoại vi.',
            specs: [
                ['THIẾT BỊ', 'Beechat Zero / dual ESP32 + BW16'],
                ['CHIP', 'ESP32 + RTL8720DN'],
                ['KẾT NỐI', 'USB + serial + LoRa / BLE / RF'],
                ['CHẾ ĐỘ', 'Web install + flash board'],
                ['CHỨC NĂNG CHÍNH', 'Chat mesh / LoRa / BLE / GPS / Sub-GHz / nRF24 / game app'],
                ['MỤC ĐÍCH', 'Dùng cho hệ thống mạng mesh, giao tiếp đa giao thức và trạm LoRa riêng']
            ],
            steps: [
                'Kết nối Beechat Zero qua cổng USB và chọn đúng COM port.',
                'Nhấn BOOT/RESET nếu board cần vào download mode.',
                'Bấm nút Install hoặc FLASH để nạp firmware.',
                'Sau khi tải xong, kiểm tra chức năng mesh chat, LoRa, GPS, NRF hoặc BLE trên thiết bị.'
            ]
        }
    };

    const selected = details[type] || details.BW16;
    image.src = selected.image;
    image.alt = `${type} device preview`;
    tableBody.innerHTML = selected.specs.map(([label, value]) => `
        <tr>
            <th>${label}</th>
            <td>${value}</td>
        </tr>
    `).join('');
    guide.innerHTML = `
        <strong>CHỨC NĂNG CHÍNH:</strong>
        <div class="device-purpose">${selected.purpose}</div>
        <strong>HƯỚNG DẪN SỬ DỤNG:</strong>
        <ol>
            ${selected.steps.map(step => `<li>${step}</li>`).join('')}
        </ol>
    `;
    panel.classList.remove('hidden');
}

async function selectFirmware(type, evt) {
    document.querySelectorAll('.firmware-option').forEach(el => {
        el.classList.remove('active');
    });

    const selectedEl = evt?.currentTarget || document.querySelector(`.firmware-option[data-fw="${type}"]`);
    if (selectedEl) selectedEl.classList.add('active');

    selectedFirmwareType = 'prebuilt';
    selectedFirmware = type;

    renderDeviceDetails(type);

    if (espInstallWrap) {
        if (type === 'ESP32') {
            espInstallWrap.classList.remove('hidden');
        } else {
            espInstallWrap.classList.add('hidden');
        }
    }

    const infoDiv = document.getElementById('selectedFirmwareInfo');
    const fwName = document.getElementById('fwName');
    const fwDetails = document.getElementById('fwDetails');
    const fwSize = document.getElementById('fwSize');
    let name = '', details = '';
    switch(type) {
        case 'BW16':
            name = '[BW16]';
            details = 'RTL8720DN BW16-KIT + 6 BUTTON + 0.96 OLED';
            break;
        case 'ESP32':
            name = '[ESP32]';
            details = 'ESP32 firmware via web install';
            break;
        default:
            throw new Error(`Unknown firmware type: ${type}`);
    }

    if (infoDiv) infoDiv.classList.remove('hidden');
    if (fwName) fwName.textContent = name;
    if (fwDetails) fwDetails.textContent = details;
    if (fwSize) fwSize.textContent = 'LOADING...';

    log('SELECTION', `Selected: ${name}`);

    if (type === 'ESP32') {
        const ready = await ensureEsp32InstallReady();
        if (!ready) {
            selectedFirmware = null;
            if (fwSize) fwSize.textContent = 'N/A';
            statusOperation.textContent = '[UNAVAILABLE]';
            return;
        }

        selectedFirmware = null;
        if (fwSize) fwSize.textContent = 'WEB';
        statusOperation.textContent = '[READY]';
        return;
    }

    try {
        const firmwareData = await loadApplicationFirmware(type);
        if (fwSize) fwSize.textContent = `${(firmwareData.length / 1024).toFixed(1)}KB`;
        selectedFirmware = firmwareData;
        statusOperation.textContent = '[READY]';
    } catch (error) {
        selectedFirmware = null;
        if (fwSize) fwSize.textContent = 'FAILED';
        log('ERROR', `Load failed: ${error.message}`);
    }
}

function log(level, msg) {
    const timestamp = new Date().toLocaleTimeString([], {hour12: false});
    const span = document.createElement('span');
    span.innerHTML = `<br><span class="text-cyan-400">[${timestamp}]</span> `;

    if (level === 'SYSTEM') {
        span.innerHTML += `<span class="text-cyan-400">[SYS]</span> ${msg}`;
    } else if (level === 'SUCCESS') {
        span.innerHTML += `<span class="text-green-400">[OK]</span> ${msg}`;
    } else if (level === 'ERROR') {
        span.innerHTML += `<span class="text-red-400">[ERR]</span> ${msg}`;
    } else if (level === 'FLASH') {
        span.innerHTML += `<span class="text-yellow-400">[FLASH]</span> ${msg}`;
    } else if (level === 'SELECTION') {
        span.innerHTML += `<span class="text-purple-400">[SEL]</span> ${msg}`;
    } else if (level === 'INFO') {
        span.innerHTML += `<span class="text-blue-400">[INFO]</span> ${msg}`;
    } else {
        span.innerHTML += msg;
    }

    const cursor = document.querySelector('.terminal-cursor');
    if (cursor) {
        cursor.remove();
    }

    logArea.appendChild(span);

    const cursorSpan = document.createElement('span');
    cursorSpan.className = 'terminal-cursor';
    logArea.appendChild(cursorSpan);

    logArea.scrollTop = logArea.scrollHeight;
}

function setProgress(percent, status) {
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${Math.floor(percent)}%`;
    if (status) progressText.textContent = `[${status}]`;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readLoop() {
    keepReading = true;
    while (port && port.readable && keepReading) {
        try {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
                inputChunks.push(value);
                inputBufferTotalLen += value.length;
                if (inputBufferTotalLen > 2000000) {
                    const remove = inputChunks.shift();
                    inputBufferTotalLen -= remove.length;
                }
            }
        } catch (error) { break; }
    }
}

async function readBytes(count, timeoutMs = 2000) {
    const startTime = Date.now();
    while (inputBufferTotalLen < count) {
        if (Date.now() - startTime > timeoutMs) throw new Error("[TIMEOUT]");
        await sleep(5);
    }
    const ret = new Uint8Array(count);
    let offset = 0;
    while (offset < count) {
        const chunk = inputChunks[0];
        const needed = count - offset;
        if (chunk.length <= needed) {
            ret.set(chunk, offset);
            offset += chunk.length;
            inputBufferTotalLen -= chunk.length;
            inputChunks.shift();
        } else {
            ret.set(chunk.slice(0, needed), offset);
            inputChunks[0] = chunk.slice(needed);
            inputBufferTotalLen -= needed;
            offset += needed;
        }
    }
    return ret;
}

async function readOneByte(timeoutMs = 1000) {
    const buf = await readBytes(1, timeoutMs);
    return buf[0];
}

async function flushBuffer() {
    inputChunks = [];
    inputBufferTotalLen = 0;
}

async function resetToFlashMode() {
    if (!port) return;
    log('SYSTEM', "Entering flash mode...");
    statusFlashMode.textContent = "[FLASH_MODE]";
    await port.setSignals({ requestToSend: true, dataTerminalReady: false });
    await sleep(500);
    await port.setSignals({ requestToSend: false, dataTerminalReady: true });
    await sleep(200);
    await port.setSignals({ requestToSend: false, dataTerminalReady: false });
    await sleep(500);
}

async function resetToBoot() {
    if (!port) return;
    log('SYSTEM', "Resetting to boot...");
    statusFlashMode.textContent = "[BOOT_MODE]";
    await port.setSignals({ requestToSend: true, dataTerminalReady: false });
    await sleep(500);
    await port.setSignals({ requestToSend: false, dataTerminalReady: false });
}

async function waitForSync(length, attempts = 500) {
    let found = 0;
    while (found < length && attempts > 0) {
        try {
            const b = await readOneByte(50);
            if (b === RET_SYNC) found++;
        } catch (e) {}
        attempts--;
    }
    return found === length;
}

async function sendCmd(cmdBuf) {
    if (cmdBuf[0] !== 0x07) {
        if (!await waitForSync(1, 20)) {} 
    }
    await writer.write(cmdBuf);
    const start = Date.now();
    while (Date.now() - start < 5000) {
        try {
            const b = await readOneByte(200);
            if (b === RET_SUCCESS) return true;
            if (b === RET_SYNC) continue; 
        } catch(e) {}
    }
    return false;
}

function calcPacketChecksum(data) {
    let sum = 0;
    for (let b of data) sum += b;
    return (0xFF + sum) & 0xFF;
}

async function writeBlock(addr, data, prefix, startPercent, endPercent, startSeqId) {
    const size = data.length;
    const numPackets = Math.ceil(size / 1024);
    log('FLASH', `Writing ${size} bytes to 0x${addr.toString(16)}...`);
    if (!await waitForSync(1)) throw new Error("[SYNC_TIMEOUT]");
    let seqId = startSeqId;
    for (let i = 0; i < numPackets; i++) {
        const chunkStart = i * 1024;
        const chunkEnd = Math.min(chunkStart + 1024, size);
        const chunk = data.slice(chunkStart, chunkEnd);
        const packet = new Uint8Array(1032);
        const view = new DataView(packet.buffer);
        const currentAddr = addr + chunkStart;
        const currentSeq = (seqId + i) & 0xFF;
        packet[0] = 0x02;
        packet[1] = currentSeq;
        packet[2] = (~currentSeq) & 0xFF;
        view.setUint32(3, currentAddr, true);
        packet.set(chunk, 7);
        if (chunk.length < 1024) packet.fill(0xFF, 7 + chunk.length, 1031);
        packet[1031] = calcPacketChecksum(packet.slice(0, 1031));
        let retries = 0;
        let success = false;
        while (!success && retries < 10) {
            await writer.write(packet);
            try {
                const b = await readOneByte(500);
                if (b === RET_SUCCESS) success = true;
            } catch (e) {}
            if(!success) {
                retries++;
                await sleep(50);
            }
        }
        if (!success) throw new Error(`[WRITE_FAIL_${i}]`);
        const packetProgress = (i + 1) / numPackets;
        const totalProgress = startPercent + (packetProgress * (endPercent - startPercent));
        setProgress(totalProgress, `${prefix} (${Math.round(packetProgress*100)}%)`);
    }
    return seqId + numPackets;
}

async function changeBaudRate(targetBaud) {
    if (!SPEED_MAP[targetBaud]) { log('ERROR', `Baud ${targetBaud} unsupported`); return; }
    log('SYSTEM', `Switching to ${targetBaud} baud...`);
    statusSpeed.textContent = `${targetBaud}`;
    const cmd = new Uint8Array([0x05, SPEED_MAP[targetBaud]]);
    await sendCmd(cmd);
    keepReading = false;
    try { await reader.cancel(); } catch(e) {}
    await writer.close();
    await port.close();
    await sleep(200);
    await port.open({ baudRate: parseInt(targetBaud) });
    writer = port.writable.getWriter();
    reader = port.readable.getReader();
    flushBuffer();
    readLoop();
    if (!await sendCmd(new Uint8Array([0x07]))) throw new Error("[BAUD_FAIL]");
    if (!await waitForSync(1)) throw new Error("[SYNC_FAIL]");
    log('SUCCESS', `Baud ${targetBaud} OK`);
}

async function runOperation(mode) {
    try {
        if (!port) {
            log('ERROR', "[NO_DEVICE] Connect device first.");
            alert("[ERROR] Connect device first!");
            return;
        }

        let operations = [];
        let loaderData = null;

        if (!selectedFirmware) {
            throw new Error("[NO_FIRMWARE] Select firmware first!");
        }

        if (!systemFirmwareCache.FLASHLOADER || !systemFirmwareCache.KM0 || !systemFirmwareCache.KM4) {
            throw new Error("[SYSTEM_NOT_LOADED] Reload application.");
        }

        loaderData = systemFirmwareCache.FLASHLOADER;

        operations.push({
            addr: 0x8000000,
            data: systemFirmwareCache.KM0,
            name: "KM0_BOOT"
        });
        operations.push({
            addr: 0x8004000,
            data: systemFirmwareCache.KM4,
            name: "KM4_BOOT"
        });

        let appData;
        if (selectedFirmwareType === 'prebuilt') {
            if (!selectedFirmware || !(selectedFirmware instanceof Uint8Array)) {
                throw new Error("[FIRMWARE_ERROR]");
            }
            appData = selectedFirmware;
            operations.push({
                addr: 0x8006000,
                data: appData,
                name: "APP_FW"
            });
        }

        log('SYSTEM', '='.repeat(40));
        log('SYSTEM', `Starting ${mode}...`);
        flashBtn.disabled = true;
        eraseBtn.disabled = true;
        statusOperation.textContent = mode === 'FLASH' ? '[FLASHING]' : '[ERASING]';

        setProgress(5, "[INIT_FLASH]");
        await resetToFlashMode();
        await flushBuffer();

        log('SYSTEM', "Handshaking...");
        if (!await waitForSync(2, 50)) {
            throw new Error("[HANDSHAKE_FAIL] Check flash mode.");
        }
        log('SUCCESS', "Handshake OK");

        const targetBaud = '1500000';
        if (targetBaud != 115200) await changeBaudRate(targetBaud);

        log('FLASH', "Loading flashloader...");
        await writeBlock(RAM_LOADER_ADDR, loaderData, "[FLASHLOADER]", 10, 30, 1);

        log('SYSTEM', "Executing flashloader...");
        if (!await waitForSync(1)) throw new Error("[EXEC_TIMEOUT]");
        await sendCmd(new Uint8Array([0x04]));
        await sleep(500);

        log('SYSTEM', "Reinit 115200...");
        keepReading = false;
        try { await reader.cancel(); } catch(e) {}
        await writer.close();
        await port.close();
        await sleep(100);
        await port.open({ baudRate: 115200 });
        writer = port.writable.getWriter();
        reader = port.readable.getReader();
        flushBuffer();
        readLoop();

        if (!await waitForSync(2)) throw new Error("[FLASHLOADER_FAIL]");

        if (mode === 'ERASE') {
             setProgress(50, "[ERASING...]");
             await sendCmd(new Uint8Array([0x26, 0x01, 0x01, 0x00]));

             const eraseAddr = 0x300000;
             const eraseSize = 0xB8000;
             const numSectors = Math.floor((eraseSize + 4095) / 4096);
             const cmdBuf = new Uint8Array(6);
             const view = new DataView(cmdBuf.buffer);
             cmdBuf[0] = 0x17;
             view.setUint32(1, eraseAddr, true);
             cmdBuf[5] = numSectors & 0xFF;

             log('FLASH', `Erase: 0x${eraseAddr.toString(16)}, Sectors:${numSectors}`);
             if (!await waitForSync(1)) throw new Error("[ERASE_SYNC_FAIL]");
             await writer.write(cmdBuf);

             let success = false;
             for(let i=0; i<3500; i++) {
                 try {
                    const b = await readOneByte(100);
                    if (b === RET_SUCCESS) { success = true; break; }
                 } catch(e) {}
                 if(i%10 === 0) setProgress(50 + (i/70), "[ERASING...]");
             }
             if (!success) throw new Error("[ERASE_TIMEOUT]");
             log('SUCCESS', "Erase complete");
        } else {
            log('FLASH', '-' . repeat(40));
            log('FLASH', "Phase 1: Preparation");
            await sendCmd(new Uint8Array([0x26, 0x01, 0x01, 0x00]));

            let currentProgress = 30;
            const progressStep = 20 / operations.length;

            for (let op of operations) {
                const sectors = Math.floor((op.data.length + 4095) / 4096);
                const eraseCmd = new Uint8Array(6);
                const view = new DataView(eraseCmd.buffer);
                eraseCmd[0] = 0x17;
                view.setUint32(1, op.addr, true);
                eraseCmd[5] = sectors & 0xFF;

                log('FLASH', `Erasing ${op.name}...`);
                if (!await waitForSync(1)) throw new Error("[ERASE_SYNC_FAIL]");
                await writer.write(eraseCmd);

                let eSuccess = false;
                for(let i=0; i<500; i++) {
                     try {
                        const b = await readOneByte(100);
                        if (b === RET_SUCCESS) { eSuccess = true; break; }
                     } catch(e) {}
                }
                if (!eSuccess) throw new Error(`[ERASE_FAIL:${op.name}]`);
                currentProgress += progressStep;
                setProgress(currentProgress, `[ERASED:${op.name}]`);
                log('SUCCESS', `${op.name} erased`);
            }

            if (targetBaud != 115200) {
                log('SYSTEM', "Switching to high speed...");
                await changeBaudRate(targetBaud);
            }

            log('FLASH', '-' . repeat(40));
            log('FLASH', "Phase 2: Programming");
            const writeStep = 30 / operations.length;

            let globalSeqId = 1;

            for (let op of operations) {
                globalSeqId = await writeBlock(op.addr, op.data, `[PROG:${op.name}]`, currentProgress, currentProgress + writeStep, globalSeqId);
                currentProgress += writeStep;
                log('SUCCESS', `${op.name} programmed`);
            }

            log('SUCCESS', "All components programmed");
        }

        setProgress(100, "[DONE]");
        log('SYSTEM', '='.repeat(40));
        log('SUCCESS', `${mode} completed`);
        log('SYSTEM', "Resetting...");
        await resetToBoot();
        statusOperation.textContent = '[DONE]';

    } catch (err) {
        log('ERROR', `Operation failed: ${err.message}`);
        console.error(err);
        setProgress(0, "[FAILED]");
        statusOperation.textContent = '[FAILED]';
    } finally {
        flashBtn.disabled = false;
        eraseBtn.disabled = false;
        statusSpeed.textContent = '115200';

        if (port) {
            keepReading = false;
            try { await reader.cancel(); } catch(e) {}
            await writer.close();
            await port.close();
            port = null;
            connectBtn.classList.remove('bg-green-600');
            connectBtn.classList.add('primary-btn');
            connectBtn.innerHTML = '<i class="fas fa-plug mr-1"></i> CONNECT';
            connectionStatus.textContent = '[DISCONNECTED]';
            statusConnection.textContent = '[IDLE]';
            statusFlashMode.textContent = '[MANUAL]';
            statusOperation.textContent = '[READY]';
        }
    }
}

connectBtn.addEventListener('click', async () => {
    if (port) {
        keepReading = false;
        if (reader) await reader.cancel();
        if (writer) await writer.close();
        await port.close();
        port = null;
        connectBtn.classList.remove('bg-green-600');
        connectBtn.classList.add('primary-btn');
        connectBtn.innerHTML = '<i class="fas fa-plug mr-1"></i> CONNECT';
        connectionStatus.textContent = '[DISCONNECTED]';
        statusConnection.textContent = '[IDLE]';
        log('SYSTEM', 'Disconnected');
        return;
    }
    try {
        log('SYSTEM', 'Scanning devices...');
        port = await navigator.serial.requestPort();
        log('SYSTEM', 'Opening port...');
        await port.open({ baudRate: 115200 });
        connectBtn.classList.remove('primary-btn');
        connectBtn.classList.add('bg-green-600');
        connectBtn.innerHTML = '<i class="fas fa-link mr-1"></i> CONNECTED';
        connectionStatus.textContent = '[CONNECTED]';
        statusConnection.textContent = '[CONNECTED]';
        writer = port.writable.getWriter();
        reader = port.readable.getReader();
        flushBuffer();
        readLoop();
        log('SUCCESS', 'Device connected');
        log('INFO', 'Ready for operations');
    } catch (e) {
        log('ERROR', `Connect failed: ${e.message}`);
    }
});

flashBtn.addEventListener('click', () => runOperation('FLASH'));
eraseBtn.addEventListener('click', () => runOperation('ERASE'));

document.addEventListener('DOMContentLoaded', function() {
    if (espInstallButton && !espInstallButton.getAttribute('manifest')) {
        espInstallButton.setAttribute('manifest', './firmware/ESP32/manifest.json');
    }
    log('SYSTEM', 'AmebaD Flasher v2.1.0 initialized');
    loadSystemFirmware();
});
