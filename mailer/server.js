// Contact form mailer: accepts POST /api/contact and sends it through ZeptoMail.
// No dependencies; needs Node 18+ for fetch.

const http = require('node:http');

const {
    ZEPTO_TOKEN,
    ZEPTO_API_URL = 'https://api.zeptomail.com',
    MAIL_FROM,
    MAIL_FROM_NAME = 'Contact Form',
    MAIL_TO,
    PORT = 3000,
} = process.env;

for (const [key, value] of Object.entries({ ZEPTO_TOKEN, MAIL_FROM, MAIL_TO })) {
    if (!value) {
        console.error(`Missing required env var ${key}`);
        process.exit(1);
    }
}

const AUTH = 'Zoho-enczapikey ' + ZEPTO_TOKEN.replace(/^Zoho-enczapikey\s+/, '');
const RECIPIENTS = MAIL_TO.split(',').map((a) => a.trim()).filter(Boolean);

const MAX_BODY = 16 * 1024;
const LIMITS = { name: 100, email: 254, company: 100, topic: 200, message: 5000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-IP rate limit, in memory: RATE_MAX submissions per RATE_WINDOW.
const RATE_MAX = 5;
const RATE_WINDOW = 60 * 60 * 1000;
const hits = new Map();

function rateLimited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
    if (recent.length >= RATE_MAX) {
        hits.set(ip, recent);
        return true;
    }
    recent.push(now);
    hits.set(ip, recent);
    return false;
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of hits) {
        if (times.every((t) => now - t >= RATE_WINDOW)) hits.delete(ip);
    }
}, RATE_WINDOW).unref();

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                // Discard the rest so we can still reply, then close the connection.
                req.removeAllListeners('data');
                req.resume();
                reject(new Error('Body too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function oneLine(value) {
    return value.replace(/[\r\n]+/g, ' ').trim();
}

function validate(params) {
    const fields = {
        name: oneLine(params.get('name') || ''),
        email: oneLine(params.get('email') || ''),
        company: oneLine(params.get('company') || ''),
        topic: oneLine(params.get('topic') || ''),
        message: (params.get('message') || '').trim(),
    };
    if (!fields.name || !fields.email || !fields.message) {
        return { error: 'Please fill in your name, email, and project details.' };
    }
    if (!EMAIL_RE.test(fields.email)) {
        return { error: 'That email address doesn\'t look right.' };
    }
    for (const [key, max] of Object.entries(LIMITS)) {
        if (fields[key].length > max) return { error: `Your ${key} is too long.` };
    }
    return { fields };
}

async function send({ name, email, company, topic, message }) {
    const from = company ? `${name} (${company})` : name;
    const subject = (topic ? `Inquiry from ${from}: ${topic}` : `Inquiry from ${from}`).slice(0, 200);
    const textbody = [
        `Name:    ${name}`,
        `Email:   ${email}`,
        `Company: ${company || '-'}`,
        `Type:    ${topic || '-'}`,
        '',
        'Project details:',
        message,
    ].join('\n');

    const res = await fetch(`${ZEPTO_API_URL}/v1.1/email`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: AUTH,
        },
        body: JSON.stringify({
            from: { address: MAIL_FROM, name: MAIL_FROM_NAME },
            to: RECIPIENTS.map((address) => ({ email_address: { address } })),
            reply_to: [{ address: email, name }],
            subject,
            textbody,
        }),
        signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
        throw new Error(`ZeptoMail ${res.status}: ${await res.text()}`);
    }
}

function respond(req, res, status, result) {
    // Plain form posts (no JS) get redirected back to the page; fetch gets JSON.
    if ((req.headers.accept || '').includes('application/json')) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
    } else {
        res.writeHead(303, { Location: result.ok ? '/contact.html#sent' : '/contact.html#send-error' });
        res.end();
    }
}

const server = http.createServer(async (req, res) => {
    if (req.url !== '/api/contact' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
    }

    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;

    let params;
    try {
        params = new URLSearchParams(await readBody(req));
    } catch {
        res.setHeader('Connection', 'close');
        return respond(req, res, 413, { ok: false, error: 'Your message is too long.' });
    }

    // Honeypot: real visitors never see this field. Pretend it worked.
    if (params.get('website')) {
        return respond(req, res, 200, { ok: true });
    }

    if (rateLimited(ip)) {
        return respond(req, res, 429, { ok: false, error: 'Too many messages. Please try again later.' });
    }

    const { fields, error } = validate(params);
    if (error) {
        return respond(req, res, 400, { ok: false, error });
    }

    try {
        await send(fields);
        console.log(`Sent inquiry from ${fields.email}`);
        respond(req, res, 200, { ok: true });
    } catch (err) {
        console.error(err);
        respond(req, res, 502, { ok: false, error: 'Something went wrong sending your message.' });
    }
});

server.listen(PORT, () => console.log(`Mailer listening on ${PORT}`));

process.on('SIGTERM', () => server.close(() => process.exit(0)));
