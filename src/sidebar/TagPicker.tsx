import { normalizeTags } from "../domain/tags";

interface TagPickerProps {
  selected: string[];
  available: string[];
  query: string;
  onQuery: (query: string) => void;
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function tagsWithQuery(selected: string[], available: string[], query: string) {
  const value = query.trim();
  return normalizeTags([...selected, available.find((tag) =>
    tag.toLocaleLowerCase() === value.toLocaleLowerCase()) ?? value]);
}

export function TagPicker({ selected, available, query, onQuery, onChange, disabled, autoFocus }: TagPickerProps) {
  const suggestions = available.filter((tag) =>
    tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    !selected.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase()));
  function add(tag: string) {
    onChange(tagsWithQuery(selected, available, tag));
    onQuery("");
  }
  return (
    <>
      <div className="tag-choices" aria-label="Selected tags">
        {selected.map((tag) => (
          <button type="button" className="tag-chip" key={tag} disabled={disabled}
            aria-label={`Remove tag ${tag}`} onClick={() => onChange(selected.filter((value) => value !== tag))}>
            {tag} <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <label className="search-box">
        <span className="sr-only">Find or create tag</span>
        <input autoFocus={autoFocus} value={query} disabled={disabled} placeholder="Find or create tag"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && query.trim()) {
              event.preventDefault();
              add(query);
            }
          }} />
      </label>
      <div className="tag-suggestions">
        <div className="tag-choices" aria-label="Existing tags">
          {suggestions.map((tag) => <button type="button" className="tag-chip" key={tag}
            disabled={disabled} onClick={() => add(tag)}>{tag}</button>)}
        </div>
        {query.trim() && !available.some((tag) => tag.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) &&
          !selected.some((tag) => tag.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) && (
          <button type="button" className="text-button" disabled={disabled} onClick={() => add(query)}>Create tag "{query.trim()}"</button>
        )}
      </div>
    </>
  );
}
