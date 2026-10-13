// Submits the contact form in place. Without JS the form still posts normally
// (with the browser's own required-field checks) and the server redirects back
// to #sent or #send-error.
const form = document.getElementById('contact-form');
const statusEl = form.querySelector('.form-status');
const button = form.querySelector('button[type="submit"]');
const buttonLabel = button.innerHTML;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Inline messages replace the browser's validation bubbles once JS is running.
form.noValidate = true;

function clearError(field) {
    const error = document.getElementById(`${field.id}-error`);
    if (!error) return;
    error.remove();
    field.removeAttribute('aria-invalid');
    const describedBy = field.dataset.describedby;
    if (describedBy) field.setAttribute('aria-describedby', describedBy);
    else field.removeAttribute('aria-describedby');
}

function showError(field, message) {
    const error = document.createElement('p');
    error.className = 'field-error';
    error.id = `${field.id}-error`;
    error.textContent = message;
    field.after(error);
    field.dataset.describedby = field.getAttribute('aria-describedby') || '';
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', `${field.dataset.describedby} ${error.id}`.trim());
}

function validate() {
    const { name, email, message } = form.elements;
    [name, email, message].forEach(clearError);

    if (!name.value.trim()) showError(name, 'Please enter your name.');
    if (!email.value.trim()) showError(email, 'Please enter your email address.');
    else if (!EMAIL.test(email.value.trim())) showError(email, 'Please enter a valid email address, like name@company.com.');
    if (!message.value.trim()) showError(message, 'Please add a short overview of your project.');

    return form.querySelector('[aria-invalid="true"]');
}

// Clear a field's message as soon as it's corrected.
form.addEventListener('input', (event) => {
    if (event.target.getAttribute('aria-invalid') === 'true') clearError(event.target);
});

function showResult(id) {
    form.hidden = true;
    const result = document.getElementById(id);
    result.classList.add('is-visible');
    result.setAttribute('tabindex', '-1');
    result.focus();
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    statusEl.textContent = '';

    const invalid = validate();
    if (invalid) {
        invalid.focus();
        return;
    }

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
            document.querySelector('#sent .sent-name').textContent = `, ${data.get('name').trim()}`;
            document.querySelector('#sent .sent-to').textContent = ` to ${data.get('email').trim()}`;
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
        button.innerHTML = buttonLabel;
    }
});
