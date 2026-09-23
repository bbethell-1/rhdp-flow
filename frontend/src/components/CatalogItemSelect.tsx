import React, { useState, useEffect, useMemo } from 'react';
import {
  FormGroup,
  MenuToggle,
  MenuToggleElement,
  Select,
  SelectList,
  SelectOption,
  Spinner,
  TextInputGroup,
  TextInputGroupMain,
  TextInputGroupUtilities,
  Button,
} from '@patternfly/react-core';
import TimesIcon from '@patternfly/react-icons/dist/esm/icons/times-icon';
import { api } from '../services/api';
import type { CatalogItemEntry } from '../types';

interface CatalogItemSelectProps {
  value: string;
  onChange: (ciName: string) => void;
  label?: string;
  isRequired?: boolean;
  helperText?: string;
  /** Prefer items in this namespace (sorted first); still shows other namespaces. */
  filterNamespace?: string;
}

/** One shared fetch for all row dropdowns — avoids rate-limit storms (30/min). */
let _sharedItems: CatalogItemEntry[] | null = null;
let _sharedPromise: Promise<CatalogItemEntry[]> | null = null;
let _sharedError: string | null = null;

function loadCatalogItemsShared(): Promise<CatalogItemEntry[]> {
  if (_sharedItems) return Promise.resolve(_sharedItems);
  if (_sharedPromise) return _sharedPromise;
  _sharedError = null;
  _sharedPromise = api
    .listCatalogItems()
    .then((data) => {
      _sharedItems = Array.isArray(data) ? data : [];
      return _sharedItems;
    })
    .catch((err: unknown) => {
      _sharedError = err instanceof Error ? err.message : 'Failed to load catalog items';
      _sharedPromise = null;
      throw err;
    });
  return _sharedPromise;
}

/**
 * Dropdown/typeahead for selecting Babylon catalog items.
 * Fetches from /api/catalog/items once (shared) and provides fuzzy search.
 */
export function CatalogItemSelect({
  value,
  onChange,
  label = 'Catalog Item (CI)',
  isRequired = false,
  helperText,
  filterNamespace,
}: CatalogItemSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [items, setItems] = useState<CatalogItemEntry[]>(_sharedItems || []);
  const [loading, setLoading] = useState(!_sharedItems);
  const [error, setError] = useState<string | null>(_sharedError);

  useEffect(() => {
    let cancelled = false;
    if (_sharedItems) {
      setItems(_sharedItems);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadCatalogItemsShared()
      .then((data) => {
        if (!cancelled) {
          setItems(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load catalog items');
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Prefer matching namespace first; never hide other NS (bare/.prod often live in prod while row says event).
  const filteredItems = useMemo(() => {
    let filtered = items;

    if (searchValue.trim()) {
      const search = searchValue.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.id.toLowerCase().includes(search) ||
          item.display_name.toLowerCase().includes(search),
      );
    }

    if (filterNamespace) {
      filtered = [...filtered].sort((a, b) => {
        const aMatch = a.catalog_namespace === filterNamespace ? 0 : 1;
        const bMatch = b.catalog_namespace === filterNamespace ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return a.id.localeCompare(b.id);
      });
    }

    return filtered.slice(0, 100);
  }, [items, filterNamespace, searchValue]);

  if (loading) {
    return (
      <FormGroup label={label} isRequired={isRequired}>
        <Spinner size="md" />
      </FormGroup>
    );
  }

  if (error) {
    return (
      <FormGroup label={label} isRequired={isRequired}>
        <div style={{ fontSize: '0.85rem', color: 'var(--pf-v6-global--danger-color--100)' }}>
          Catalog lookup failed: {error}
        </div>
        <Button
          variant="link"
          isInline
          size="sm"
          onClick={() => {
            _sharedItems = null;
            _sharedPromise = null;
            _sharedError = null;
            setLoading(true);
            setError(null);
            loadCatalogItemsShared()
              .then((data) => { setItems(data); setError(null); })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Failed to load catalog items');
              })
              .finally(() => setLoading(false));
          }}
        >
          Retry
        </Button>
      </FormGroup>
    );
  }

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle variant="typeahead" onClick={() => setIsOpen(!isOpen)} isExpanded={isOpen} ref={toggleRef}>
      <TextInputGroup isPlain>
        <TextInputGroupMain
          value={searchValue || value}
          onClick={() => setIsOpen(!isOpen)}
          onChange={(_event, newValue) => setSearchValue(newValue)}
          autoComplete="off"
          placeholder={value || 'Type to search catalog items...'}
          role="combobox"
          isExpanded={isOpen}
          aria-controls="select-typeahead-listbox"
        />
        <TextInputGroupUtilities>
          {(searchValue || value) && (
            <Button
              variant="plain"
              onClick={() => {
                onChange('');
                setSearchValue('');
              }}
              aria-label="Clear"
            >
              <TimesIcon aria-hidden />
            </Button>
          )}
        </TextInputGroupUtilities>
      </TextInputGroup>
    </MenuToggle>
  );

  return (
    <FormGroup label={label} isRequired={isRequired} fieldId="catalog-select">
      <Select
        isOpen={isOpen}
        onOpenChange={(open) => setIsOpen(open)}
        onSelect={(_event, itemId) => {
          if (typeof itemId === 'string') {
            onChange(itemId);
            setSearchValue('');
            setIsOpen(false);
          }
        }}
        toggle={toggle}
        shouldFocusToggleOnSelect
      >
        <SelectList id="select-typeahead-listbox">
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <SelectOption key={`${item.catalog_namespace}/${item.id}`} value={item.id} description={`${item.catalog_namespace} — ${item.display_name}`}>
                {item.id}
              </SelectOption>
            ))
          ) : (
            <SelectOption isDisabled>
              {searchValue ? `No matches for "${searchValue}"` : 'No catalog items available'}
            </SelectOption>
          )}
        </SelectList>
      </Select>
      {helperText && <div style={{ fontSize: '0.875rem', color: '#6a6e73', marginTop: 4 }}>{helperText}</div>}
    </FormGroup>
  );
}
