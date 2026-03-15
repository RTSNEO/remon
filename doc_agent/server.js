const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const HTMLToDOCX = require('html-to-docx');
const GeminiAutomator = require('./gemini_automator');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const automator = new GeminiAutomator();
let currentTask = null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Socket.IO Connection for Real-Time Updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Helper function to send status updates
function updateStatus(message, type = 'info', progress = null) {
  io.emit('statusUpdate', { message, type, progress });
}

// 1. Endpoint: Connect & Generate Initial Outline
app.post('/api/generate-outline', async (req, res) => {
  if (currentTask && currentTask !== 'outline') {
    return res.status(400).json({ error: 'Another task is currently running.' });
  }

  const { customGemUrl, docType, standards, additionalInstructions } = req.body;

  if (!customGemUrl || !docType) {
    return res.status(400).json({ error: 'Missing required parameters (customGemUrl, docType).' });
  }

  currentTask = 'outline';

  try {
    updateStatus('Connecting to Gemini...', 'info', 10);
    await automator.init(customGemUrl);

    updateStatus('Gemini connected. Generating outline...', 'info', 30);

    // Construct the prompt for the outline
    let prompt = `Act as an expert Systems Engineer. Generate a highly detailed Chapter and Section Outline for a 500-page ${docType} (e.g., SRD, HLD, LLD) for a large-scale ITS (Intelligent Transportation Systems) project. `;

    if (standards) {
      prompt += `The outline MUST strictly adhere to the following standards: ${standards}. `;
    }

    prompt += `Please format the outline clearly with numbered chapters and sub-sections (e.g., 1.0, 1.1, 1.1.1). Do NOT generate the content yet, ONLY the outline. `;

    if (additionalInstructions) {
      prompt += `Additional Instructions: ${additionalInstructions}`;
    }

    const response = await automator.sendPrompt(prompt);

    updateStatus('Outline generated successfully. Please review and approve.', 'success', 100);

    res.json({ success: true, outline: response.text, htmlOutline: response.html });
  } catch (error) {
    console.error('Error generating outline:', error);
    updateStatus(`Error: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  } finally {
    currentTask = null;
  }
});

// 2. Endpoint: Generate Full Document from Approved Outline
app.post('/api/generate-document', async (req, res) => {
  if (currentTask) {
    return res.status(400).json({ error: 'Another task is currently running.' });
  }

  const { approvedOutline, customGemUrl, docType, isRtmIncluded } = req.body;

  if (!approvedOutline || !customGemUrl) {
    return res.status(400).json({ error: 'Missing required parameters.' });
  }

  currentTask = 'document';
  // Send immediate 200 response to free up the client; processing continues in background
  res.json({ success: true, message: 'Document generation started in background.' });

  try {
    updateStatus('Starting full document generation process...', 'info', 0);

    if (!automator.page) {
        await automator.init(customGemUrl);
    }

    // Parse the outline to extract chapters. We split by major headers (e.g., "1.0", "Chapter 1", "I.")
    // using a robust split mechanism to ensure full content block extraction.
    const splitRegex = /\n(?=(?:Chapter\s+\d+|[A-Z]\.|\d+\.\d*(?!\.\d+))\b)/i;
    const testRegex = /^(?:Chapter\s+\d+|[A-Z]\.|\d+\.\d*(?!\.\d+))\b/i;

    let chapters = approvedOutline.split(splitRegex);
    chapters = chapters.filter(c => testRegex.test(c.trim()));

    if (!chapters || chapters.length === 0) {
        throw new Error("Could not parse chapters from the approved outline. Ensure it follows a standard numbered format on new lines (e.g., '1.0 Introduction' or 'Chapter 1').");
    }

    let fullDocumentHtml = `<h1>${docType}</h1><h2>Approved Outline</h2>${approvedOutline.replace(/\n/g, '<br>')}<hr>`;

    updateStatus(`Parsed ${chapters.length} chapters. Beginning sequential generation...`, 'info', 5);

    for (let i = 0; i < chapters.length; i++) {
        const chapterNum = i + 1;
        const chapterTitle = chapters[i].split('\n')[0].trim();
        const progress = 5 + Math.floor((i / chapters.length) * 85); // Progress from 5% to 90%

        updateStatus(`Generating Chapter ${chapterNum}/${chapters.length}: ${chapterTitle}...`, 'info', progress);

        // Prompt Gemini for this specific chapter
        const chapterPrompt = `Based on the outline we just agreed upon for the ITS ${docType}, please write the FULL, comprehensive content for the following chapter/section ONLY. Make it highly detailed, professional, and exhaustive (aiming for multiple pages of content for this section alone). Do not summarize.

        Target Chapter to generate now:
        ${chapters[i]}
        `;

        const response = await automator.sendPrompt(chapterPrompt);
        fullDocumentHtml += response.html + '<br><br>';

        // Wait a bit to avoid overwhelming the interface
        await new Promise(r => setTimeout(r, 5000));
    }

    // Handle RTM specifically if requested
    if (isRtmIncluded) {
        updateStatus('Generating Requirement Traceability Matrix (RTM)...', 'info', 92);

        const rtmPrompt = `Now that we have generated the full ${docType}, please generate a comprehensive Requirement Traceability Matrix (RTM) chapter. Cross-reference the requirements detailed in this document with the source data (e.g., SRD, ARC-IT, ConOps) uploaded to this Custom Gem. Present the RTM as a structured table.`;

        const rtmResponse = await automator.sendPrompt(rtmPrompt);
        fullDocumentHtml += `<h2>Requirement Traceability Matrix (RTM)</h2>` + rtmResponse.html;
    }

    updateStatus('All chapters generated. Converting to Word Document...', 'info', 95);

    // Convert aggregated HTML to DOCX
    const fileBuffer = await HTMLToDOCX(fullDocumentHtml, null, {
        table: { row: { cantSplit: true } },
        footer: true,
        pageNumber: true,
    });

    const fileName = `${docType}_${Date.now()}.docx`;
    const filePath = path.join(downloadsDir, fileName);

    fs.writeFileSync(filePath, fileBuffer);

    updateStatus(`Document generation complete! Download ready.`, 'success', 100);

    // Send a special event with the download link
    io.emit('documentReady', { downloadUrl: `/api/download/${fileName}`, fileName });

  } catch (error) {
    console.error('Error generating document:', error);
    updateStatus(`Generation Error: ${error.message}`, 'error');
  } finally {
    currentTask = null;
    // Keep browser open for potential future requests, or close it if preferred
    // await automator.close();
  }
});

// 3. Endpoint: Download the generated Word doc
app.get('/api/download/:filename', (req, res) => {
    const filePath = path.join(downloadsDir, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: 'File not found.' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on port ${PORT} at http://127.0.0.1:${PORT}`);
});
