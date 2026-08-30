import { useState } from 'react';

import { serializeCriteria, type Criteria } from '../../shared/criteria';
import { watchId, type Watch } from '../../shared/watch';

/** Opens watches.json directly in GitHub's web editor - paste, commit, done. */
const EDIT_URL = 'https://github.com/alexisdionne/amc-website-wrapper/edit/main/watches.json';

interface Props {
  criteria: Criteria;
  matchCount: number;
}

export function SaveWatch({ criteria, matchCount }: Props): React.JSX.Element {
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);

  const query = serializeCriteria(criteria);

  // An empty query would match the entire feed, and parseWatches rejects it
  // outright rather than let someone arm a watch on everything by accident.
  if (query === '') {
    return (
      <fieldset>
        <legend>Save as watch</legend>
        <p className="muted">
          Set at least one filter first. A watch with no filters would match every activity.
        </p>
      </fieldset>
    );
  }

  const watch: Watch = { name: name.trim() === '' ? 'Untitled watch' : name.trim(), query };
  const json = JSON.stringify(watch, null, 2);

  const copy = (): void => {
    void navigator.clipboard.writeText(json).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  };

  return (
    <fieldset>
      <legend>Save as watch</legend>

      <label>
        Name{' '}
        <input
          type="text"
          value={name}
          maxLength={80}
          placeholder="Weekend hikes near Boston"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <p className="muted">
        Matches {matchCount} activities now. Arming seeds silently - you will be alerted about
        activities that appear <em>after</em> this is added, not the ones listed above.
      </p>

      {/* Read-only rather than a <pre>: selectable and scrollable even if the
          clipboard API is unavailable or blocked. */}
      <textarea readOnly rows={4} cols={60} value={json} aria-label="Watch JSON to copy" />

      <p>
        <button type="button" onClick={copy}>
          Copy JSON
        </button>{' '}
        <a href={EDIT_URL} target="_blank" rel="noreferrer">
          Open watches.json on GitHub
        </a>{' '}
        <span role="status" aria-live="polite" className="muted">
          {copied ? 'Copied' : ''}
        </span>
      </p>

      <p className="muted">
        Paste inside the array and commit. Watch id will be <code>{watchId(watch)}</code>, derived
        from the filters - editing them later creates a new watch rather than reusing this one.
      </p>
    </fieldset>
  );
}
