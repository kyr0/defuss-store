// "Get state" and "Set state": the store driven from outside the UI, through its API only. Get shows `store.get()`;
// Set parses the JSON, runs the demo's validator and calls `store.set(value)` - the view, the devtools and localStorage
// all follow from that one call. A rejected value never reaches the store. An editable JSON value rather than a fixed
// preset button: visitors can try a wrong value and watch validate() keep it out. VERIFIED: the Get/Set state e2e
// rejects invalid JSON and an extra key, and the stored value stays unchanged.
import { withCode } from '../assets/dom.js';

export function createStateDialog(dialog) {
  const title = dialog.querySelector('#state-title');
  const call = dialog.querySelector('#state-call');
  const lead = dialog.querySelector('#state-lead');
  const json = dialog.querySelector('#state-json');
  const error = dialog.querySelector('#state-error');
  const errorText = dialog.querySelector('#state-error-text');
  const apply = dialog.querySelector('#state-apply');
  const copy = dialog.querySelector('#state-copy');
  const status = dialog.querySelector('#state-status');
  let target = null;

  function open(mode, demo) {
    target = demo;
    const get = mode === 'get';
    title.textContent = get ? `Get the ${demo.name} state` : `Set the ${demo.name} state`;
    call.textContent = get ? `${demo.name}Store.get()` : `${demo.name}Store.set(value)`;
    lead.replaceChildren(...withCode(get
      ? 'The current snapshot, by reference. Change something in the demo and open this again.'
      : `Edit the JSON and apply it. validate() checks ${demo.shape} first; a rejected value leaves the store untouched.`));
    json.value = JSON.stringify(get ? demo.store.get() : demo.sample, null, 2);
    json.readOnly = get;
    error.hidden = true;
    apply.hidden = get;
    copy.hidden = !get;
    status.textContent = '';
    dialog.api.setState('open');
  }

  apply.addEventListener('click', () => {
    let value;
    try {
      value = JSON.parse(json.value);
    } catch (parseError) {
      errorText.textContent = `Not JSON: ${parseError.message}`;
      error.hidden = false;
      return;
    }
    if (!target.validate(value)) {
      errorText.replaceChildren(...withCode(`validate() returned false. Expected ${target.shape}.`));
      error.hidden = false;
      return;
    }
    target.store.set(value);
    dialog.api.setState('default');
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(json.value);
      status.textContent = 'Copied';
    } catch {
      status.textContent = 'Copy failed';
    }
  });

  return { open };
}
