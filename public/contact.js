// Submits the contact form in place. Without JS the form still posts normally
// and the server redirects back to #sent or #send-error.
const form = document.getElementById('contact-form');
const statusEl = form.querySelector('.form-status');
const button = form.querySelector('button[type="submit"]');

function showResult(id) {
    form.hidden = true;
    document.getElementById(id).classList.add('is-visible');
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    statusEl.textContent = '';
    button.disabled = true;
    button.textContent = 'Sending…';

    const data = new URLSearchParams(new FormData(form));

    try {
        const res = await fetch(form.action, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: data,
        });
        const result = await res.json().catch(() => ({}));

        if (result.ok) {
            document.querySelector('#sent .sent-to').textContent = `at ${data.get('email')} soon`;
            showResult('sent');
        } else if (res.status === 400 || res.status === 413 || res.status === 429) {
            statusEl.textContent = result.error;
        } else {
            showResult('send-error');
        }
    } catch {
        showResult('send-error');
    } finally {
        button.disabled = false;
        button.textContent = 'Send it →';
    }
});
