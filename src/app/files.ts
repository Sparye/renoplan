/** Offers text as a file to save. */
export function download(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Asks the user for a file and reads it as text; null if they cancel. */
export function pickFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () =>
      resolve(input.files?.[0] ? await input.files[0].text() : null)
    );
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export const fileName = (name: string) => `${name.replace(/[^\w\- ]+/g, '').trim() || 'house'}.renoplan.json`;
