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

interface CatalogItem {
  id: string;
  display_name: string;
  catalog_namespace: string;
  description?: string;
  category?: string;
}

interface CatalogItemSelectProps {
  value: string;
  onChange: (ciName: string) => void;
  label?: string;
  isRequired?: boolean;
  helperText?: string;
  filterNamespace?: string; // e.g., "babylon-catalog-event"
}

/**
 * Dropdown/typeahead for selecting Babylon catalog items.
 * Fetches from /api/catalog/items and provides fuzzy search.
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
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadItems = async () => {
      try {
        const response = await fetch('/api/catalog/items');
        const data = await response.json();
        setItems(data || []);
      } catch (error) {
        console.error('Failed to load catalog items:', error);
      } finally {
        setLoading(false);
      }
    };

    loadItems();
  }, []);

  // Filter items by namespace and search text
  const filteredItems = useMemo(() => {
    let filtered = items;

    // Filter by namespace if specified
    if (filterNamespace) {
      filtered = filtered.filter((item) => item.catalog_namespace === filterNamespace);
    }

    // Filter by search text (fuzzy match on id and display_name)
    if (searchValue.trim()) {
      const search = searchValue.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.id.toLowerCase().includes(search) ||
          item.display_name.toLowerCase().includes(search)
      );
    }

    return filtered.slice(0, 100); // Limit to 100 results for performance
  }, [items, filterNamespace, searchValue]);

  if (loading) {
    return (
      <FormGroup label={label} isRequired={isRequired}>
        <Spinner size="md" />
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
        onOpenChange={(isOpen) => setIsOpen(isOpen)}
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
              <SelectOption key={item.id} value={item.id} description={`${item.catalog_namespace} — ${item.display_name}`}>
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
