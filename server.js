const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads directory exists
const uploadsRoot = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsRoot)) {
	fs.mkdirSync(uploadsRoot, { recursive: true });
}

// Multer storage: store in uploads/<clientName>/
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		const clientNameRaw = req.body.name || 'anonymous';
		const clientNameSafe = clientNameRaw
			.toLowerCase()
			.replace(/[^a-z0-9\-\_\s]/g, '')
			.trim()
			.replace(/\s+/g, '-');
		const clientDir = path.join(uploadsRoot, clientNameSafe || 'anonymous');
		fs.mkdirSync(clientDir, { recursive: true });
		cb(null, clientDir);
	},
	filename: function (req, file, cb) {
		const timestamp = Date.now();
		const ext = path.extname(file.originalname) || '.jpg';
		const base = path.basename(file.originalname, ext).replace(/[^a-z0-9\-\_\s]/gi, '').trim().replace(/\s+/g, '-');
		cb(null, `${base || 'upload'}-${timestamp}${ext}`);
	}
});

const upload = multer({ storage });

// Serve static assets
app.use('/uploads', express.static(uploadsRoot));
app.use(express.static(path.join(__dirname)));

// Health endpoint
app.get('/api/health', (req, res) => {
	res.json({ status: 'ok' });
});

// Helper: create transporter
function createTransporter() {
	const { GMAIL_USER, GMAIL_PASS } = process.env;
	if (!GMAIL_USER || !GMAIL_PASS) {
		throw new Error('Missing GMAIL_USER or GMAIL_PASS in environment');
	}
	return nodemailer.createTransport({
		service: 'gmail',
		auth: {
			user: GMAIL_USER,
			pass: GMAIL_PASS,
		},
	});
}

// Helper: build email content
function buildEmailHtml({ name, email, phone, whatsapp, productDetails, imagePaths }) {
	const imageList = (imagePaths || []).map(p => `<li><a href="${p}">${p}</a></li>`).join('');
	return `
		<h2>New Product Request</h2>
		<p><strong>Name:</strong> ${name || ''}</p>
		<p><strong>Email:</strong> ${email || ''}</p>
		<p><strong>Phone:</strong> ${phone || ''}</p>
		<p><strong>WhatsApp:</strong> ${whatsapp || ''}</p>
		<p><strong>Details:</strong> ${productDetails || ''}</p>
		<p><strong>Images:</strong></p>
		<ul>${imageList}</ul>
	`;
}

// POST /api/requests - handle form submission with image upload
app.post('/api/requests', upload.array('images', 6), async (req, res) => {
	try {
		const { name, email, phone, whatsapp, productDetails } = req.body;

		const fileRelativePaths = (req.files || []).map(f => {
			const rel = `/uploads/${path.relative(uploadsRoot, f.path).split(path.sep).join('/')}`;
			return rel;
		});

		// Persist submission
		const submission = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name,
			email,
			phone,
			whatsapp,
			productDetails,
			images: fileRelativePaths,
			createdAt: new Date().toISOString(),
		};

		appendSubmission(submission);

		// Send email
		const transporter = createTransporter();
		const toAddress = process.env.NOTIFY_TO || process.env.GMAIL_USER;
		await transporter.sendMail({
			from: `Product Requests <${process.env.GMAIL_USER}>`,
			to: toAddress,
			subject: `New client request: ${name || 'Unknown'} is searching for a product`,
			html: buildEmailHtml({ name, email, phone, whatsapp, productDetails, imagePaths: fileRelativePaths }),
		});

		res.json({ ok: true, message: 'Request received. We will contact you soon.' });
	} catch (err) {
		console.error(err);
		res.status(500).json({ ok: false, error: 'Failed to process request' });
	}
});

// Data storage utilities
const dataDir = path.join(__dirname, 'data');
const dataFilePath = path.join(dataDir, 'submissions.json');

function ensureDataFile() {
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}
	if (!fs.existsSync(dataFilePath)) {
		fs.writeFileSync(dataFilePath, JSON.stringify({ submissions: [] }, null, 2), 'utf8');
	}
}

function appendSubmission(submission) {
	ensureDataFile();
	let data = { submissions: [] };
	try {
		const raw = fs.readFileSync(dataFilePath, 'utf8');
		data = JSON.parse(raw || '{"submissions":[]}');
	} catch (_e) {}
	data.submissions.push(submission);
	fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
}

// Admin: list submissions (simple JSON)
app.get('/api/requests', (req, res) => {
	ensureDataFile();
	try {
		const raw = fs.readFileSync(dataFilePath, 'utf8');
		const json = JSON.parse(raw || '{"submissions":[]}');
		res.json(json);
	} catch (e) {
		res.json({ submissions: [] });
	}
});

app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});