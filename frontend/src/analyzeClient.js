/**
 * Sends the analysis request and reads the streamed progress events.
 * Uses XMLHttpRequest so we get real upload progress AND incremental response text.
 */
export function streamAnalysis({ url, formData, onUpload, onEvent, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);

    let seen = 0;
    let buffer = '';

    const emit = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        onEvent(JSON.parse(trimmed));
      } catch {
        /* ignore malformed line */
      }
    };

    const drain = (final = false) => {
      const text = xhr.responseText;
      buffer += text.slice(seen);
      seen = text.length;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        emit(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
      if (final && buffer.trim()) {
        emit(buffer);
        buffer = '';
      }
    };

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onUpload) onUpload(Math.round((e.loaded / e.total) * 100));
    };
    xhr.upload.onload = () => onUpload && onUpload(100);

    xhr.onprogress = () => {
      if (xhr.status === 200) drain();
    };

    xhr.onload = () => {
      if (xhr.status !== 200) {
        reject(Object.assign(new Error(`HTTP ${xhr.status}`), { status: xhr.status }));
        return;
      }
      drain(true);
      resolve();
    };

    xhr.onerror = () => reject(Object.assign(new Error('Network error'), { network: true }));
    xhr.onabort = () => reject(Object.assign(new Error('Cancelled'), { aborted: true }));

    if (signal) {
      if (signal.aborted) {
        reject(Object.assign(new Error('Cancelled'), { aborted: true }));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort());
    }

    xhr.send(formData);
  });
}