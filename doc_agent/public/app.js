const socket = io();

// DOM Elements
const sections = {
    config: document.getElementById('config-section'),
    status: document.getElementById('status-section'),
    outline: document.getElementById('outline-section'),
    success: document.getElementById('success-section')
};

const formConfig = document.getElementById('config-form');
const btnGenerateFull = document.getElementById('btn-generate-full');
const btnBackToConfig = document.getElementById('btn-back-to-config');
const btnStartOver = document.getElementById('btn-start-over');
const downloadLink = document.getElementById('download-link');
const approvedOutlineArea = document.getElementById('approvedOutline');

// Status Elements
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const statusLog = document.getElementById('status-log');

// State
let appState = {
    customGemUrl: '',
    docType: '',
    standards: '',
    additionalInstructions: '',
    isRtmIncluded: true
};

// UI Navigation Functions
function showSection(sectionName) {
    Object.values(sections).forEach(sec => sec.classList.remove('active'));

    // Status section can be shown alongside others
    if (sectionName === 'status' || sectionName === 'status-only') {
        sections.status.classList.add('active');
    }

    if (sectionName !== 'status-only') {
        sections[sectionName].classList.add('active');
        if (sectionName !== 'config') {
             sections.status.classList.add('active');
        }
    }
}

function logMessage(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${msg}`;

    statusLog.appendChild(entry);
    statusLog.scrollTop = statusLog.scrollHeight;
}

function updateProgress(value) {
    if (value !== null && value !== undefined) {
        progressBar.style.width = `${value}%`;
        progressText.textContent = `${value}%`;
    }
}

function disableButtons(disabled) {
    const buttons = document.querySelectorAll('button');
    buttons.forEach(btn => btn.disabled = disabled);
}

// Socket Event Listeners for Real-Time Updates
socket.on('statusUpdate', (data) => {
    logMessage(data.message, data.type);
    updateProgress(data.progress);

    // Auto-scroll logic if needed
    if (data.type === 'error') {
        disableButtons(false);
    }
});

socket.on('documentReady', (data) => {
    logMessage('Document ready for download!', 'success');
    updateProgress(100);

    downloadLink.href = data.downloadUrl;
    downloadLink.download = data.fileName;

    disableButtons(false);
    showSection('success');
    sections.status.classList.add('active'); // Keep status visible
});

// Step 1: Submit Configuration -> Generate Outline
formConfig.addEventListener('submit', async (e) => {
    e.preventDefault();

    appState.customGemUrl = document.getElementById('customGemUrl').value;
    appState.docType = document.getElementById('docType').value;
    appState.standards = document.getElementById('standards').value;
    appState.additionalInstructions = document.getElementById('additionalInstructions').value;

    disableButtons(true);
    showSection('status-only');

    statusLog.innerHTML = ''; // Clear previous logs
    updateProgress(0);
    logMessage('Starting outline generation process...', 'info');

    try {
        const response = await fetch('/api/generate-outline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appState)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            approvedOutlineArea.value = data.outline;
            showSection('outline');
        } else {
            throw new Error(data.error || 'Unknown error occurred.');
        }
    } catch (error) {
        logMessage(`Failed: ${error.message}`, 'error');
        showSection('config'); // Go back on error
    } finally {
        disableButtons(false);
    }
});

// Step 2: Submit Approved Outline -> Generate Full Document
btnGenerateFull.addEventListener('click', async () => {
    const approvedOutline = approvedOutlineArea.value.trim();

    if (!approvedOutline) {
        alert('Outline cannot be empty.');
        return;
    }

    appState.isRtmIncluded = document.getElementById('includeRtm').checked;

    disableButtons(true);
    showSection('status-only');

    logMessage('Submitting approved outline. Starting full document generation...', 'info');
    updateProgress(0);

    try {
        const response = await fetch('/api/generate-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                approvedOutline,
                customGemUrl: appState.customGemUrl,
                docType: appState.docType,
                isRtmIncluded: appState.isRtmIncluded
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to start document generation.');
        }

        logMessage(data.message, 'success');
        // The rest of the process is handled via Socket.IO events (statusUpdate, documentReady)

    } catch (error) {
        logMessage(`Failed: ${error.message}`, 'error');
        disableButtons(false);
        showSection('outline');
    }
});

// Navigation Buttons
btnBackToConfig.addEventListener('click', () => {
    showSection('config');
});

btnStartOver.addEventListener('click', () => {
    formConfig.reset();
    statusLog.innerHTML = '';
    updateProgress(0);
    showSection('config');
});

// Initial Setup
showSection('config');