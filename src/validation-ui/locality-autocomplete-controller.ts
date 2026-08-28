import { PROJECT_CONFIG } from '../config';
import { searchValidationLocalities } from './autocomplete';
import type { ValidationLocality } from './validation-data';

class LocalityAutocompleteController {
  private results: readonly ValidationLocality[] = [];
  private activeIndex = -1;

  constructor(
    private readonly input: HTMLInputElement,
    private readonly list: HTMLElement,
    private readonly localities: readonly ValidationLocality[],
    private readonly onSelection: (
      locality: ValidationLocality | undefined,
    ) => void,
  ) {
    input.addEventListener('input', () => {
      this.onSelection(undefined);
      this.refresh();
    });
    input.addEventListener('focus', () => this.refresh());
    input.addEventListener('blur', () => {
      window.setTimeout(() => this.close(), 120);
    });
    input.addEventListener('keydown', (event) => this.handleKey(event));
  }

  private refresh(): void {
    this.results = searchValidationLocalities(
      this.localities,
      this.input.value,
      PROJECT_CONFIG.validationUi.autocompleteResultLimit,
    );
    this.activeIndex = this.results.length > 0 ? 0 : -1;
    this.render();
  }

  private render(): void {
    this.list.replaceChildren();
    this.results.forEach((locality, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `autocomplete-option${index === this.activeIndex ? ' is-active' : ''}`;
      option.role = 'option';
      option.setAttribute(
        'aria-selected',
        index === this.activeIndex ? 'true' : 'false',
      );
      option.textContent = `${locality.postalCode} ${locality.city}`;
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => this.choose(locality));
      this.list.append(option);
    });
    const isOpen = this.results.length > 0;
    this.list.hidden = !isOpen;
    this.input.setAttribute('aria-expanded', String(isOpen));
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (this.results.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % this.results.length;
      this.render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex =
        (this.activeIndex - 1 + this.results.length) % this.results.length;
      this.render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const locality = this.results[this.activeIndex];
      if (locality !== undefined) {
        this.choose(locality);
      }
    }
  }

  private choose(locality: ValidationLocality): void {
    this.input.value = `${locality.postalCode} ${locality.city}`;
    this.close();
    this.onSelection(locality);
  }

  private close(): void {
    this.results = [];
    this.activeIndex = -1;
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
  }
}

export function initializeLocalityAutocomplete(
  input: HTMLInputElement,
  list: HTMLElement,
  localities: readonly ValidationLocality[],
  onSelection: (locality: ValidationLocality | undefined) => void,
): LocalityAutocompleteController {
  return new LocalityAutocompleteController(
    input,
    list,
    localities,
    onSelection,
  );
}
