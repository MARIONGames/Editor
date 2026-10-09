/** Opens the system file picker and resolves with the chosen files (empty if cancelled). */
export function pickFiles(opts: { accept: string; multiple?: boolean; capture?: 'user' | 'environment' }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = opts.accept;
    input.multiple = !!opts.multiple;
    if (opts.capture) input.setAttribute('capture', opts.capture);
    input.style.display = 'none';
    let done = false;
    const finish = (files: File[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export const ACCEPT_VISUAL = 'image/*,video/*,.mov,.mkv,.heic,.heif';
export const ACCEPT_IMAGE = 'image/*,.heic,.heif';
export const ACCEPT_VIDEO = 'video/*,.mov,.mkv';
export const ACCEPT_AUDIO = 'audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac';
