'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  PackageCheck,
  PackageX,
  Search,
  Dumbbell,
  Flame,
  Wheat,
  Activity,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  X,
  Save
} from 'lucide-react';
import type { InventoryItem, OfferCategory } from '../../types/contracts';
import type { GoogleUserProfile } from '../../services/auth/googleSsoService';
import type { UserDashboardData } from '../../services/db/userDatabaseService';
import {
  saveUserDashboard,
  syncInventoryWithUserStock
} from '../../services/db/userDatabaseService';

interface InventoryViewProps {
  currentUser?: GoogleUserProfile;
  dashboard?: UserDashboardData;
  onDashboardUpdated?: (updated: UserDashboardData) => void;
  onInventoryUpdated?: () => void;
  className?: string;
}

interface InventorySummary {
  total: number;
  inStock: number;
  outOfStock: number;
  byCategory: Record<OfferCategory, { total: number; inStock: number }>;
}

const CATEGORIES: Array<{ key: 'Alle' | OfferCategory; label: string }> = [
  { key: 'Alle', label: 'Alle varer' },
  { key: 'Tørrvarer/Belgvekster', label: 'Tørrvarer & Belgvekster' },
  { key: 'Kjøl/Tofu', label: 'Kjøl & Tofu' },
  { key: 'Frukt & Grønt', label: 'Frukt & Grønt' },
  { key: 'Krydder/Sauser', label: 'Krydder & Sauser' },
  { key: 'Annet', label: 'Annet' }
];

const ITEM_CATEGORIES: OfferCategory[] = [
  'Tørrvarer/Belgvekster',
  'Kjøl/Tofu',
  'Frukt & Grønt',
  'Krydder/Sauser',
  'Annet'
];

export default function InventoryView({
  currentUser,
  dashboard,
  onDashboardUpdated,
  onInventoryUpdated,
  className = ''
}: InventoryViewProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Søk
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<'Alle' | OfferCategory>('Alle');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'IN_STOCK' | 'OUT_OF_STOCK'>('ALL');

  // Modal State for Ny/Rediger matvare
  const [isItemModalOpen, setIsItemModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formProtein, setFormProtein] = useState<number | string>(15);
  const [formKcal, setFormKcal] = useState<number | string>(120);
  const [formCategory, setFormCategory] = useState<OfferCategory>('Tørrvarer/Belgvekster');
  const [formInStock, setFormInStock] = useState<boolean>(true);
  const [formIsCarbBase, setFormIsCarbBase] = useState<boolean>(false);
  const [formIsGutHealth, setFormIsGutHealth] = useState<boolean>(false);
  const [isSavingItem, setIsSavingItem] = useState<boolean>(false);
  const [isDeletingItem, setIsDeletingItem] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Hjelpefunksjon for å beregne summary lokalt
  const computeLocalSummary = (itemList: InventoryItem[]): InventorySummary => {
    const inStock = itemList.filter((i) => i.inStock).length;
    const byCategory: Record<OfferCategory, { total: number; inStock: number }> = {
      'Frukt & Grønt': { total: 0, inStock: 0 },
      'Tørrvarer/Belgvekster': { total: 0, inStock: 0 },
      'Kjøl/Tofu': { total: 0, inStock: 0 },
      'Krydder/Sauser': { total: 0, inStock: 0 },
      'Annet': { total: 0, inStock: 0 }
    };
    for (const item of itemList) {
      if (!byCategory[item.category]) {
        byCategory[item.category] = { total: 0, inStock: 0 };
      }
      byCategory[item.category].total++;
      if (item.inStock) byCategory[item.category].inStock++;
    }
    return {
      total: itemList.length,
      inStock,
      outOfStock: itemList.length - inStock,
      byCategory
    };
  };

  // Hent inventar ved oppstart (med synkronisering mot brukerens lagrede stockMap)
  const loadInventory = async () => {
    setLoading(true);
    setError(null);

    let rawItems: InventoryItem[] = [];

    // 1. Sjekk localStorage først
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('user_inventory');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as InventoryItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            rawItems = parsed;
          }
        } catch {}
      }
    }

    // 2. Prøv API hvis ikke funnet lokalt
    if (rawItems.length === 0) {
      try {
        const res = await fetch('/api/inventory');
        if (res.ok) {
          const data = await res.json();
          rawItems = data.items || [];
        } else {
          throw new Error('API feilet');
        }
      } catch {
        // 3. Fallback til statisk public/data/inventory.json
        try {
          const staticRes = await fetch('./data/inventory.json').catch(() =>
            fetch('/data/inventory.json')
          );
          if (staticRes.ok) {
            rawItems = (await staticRes.json()) as InventoryItem[];
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Feil ved lasting av inventar');
        }
      }
    }

    // Synkroniser med brukerens personlige stockMap dersom tilgjengelig
    if (dashboard?.inventoryStockMap && rawItems.length > 0) {
      rawItems = syncInventoryWithUserStock(rawItems, dashboard.inventoryStockMap);
    }

    setItems(rawItems);
    setSummary(computeLocalSummary(rawItems));
    setLoading(false);
  };

  useEffect(() => {
    loadInventory();
  }, [dashboard?.userId]);

  // Lynrask optimistisk toggle for "På lager" med per-bruker lagring
  const toggleInStock = async (item: InventoryItem) => {
    const newStatus = !item.inStock;

    // 1. Optimistisk UI-oppdatering (0 ms)
    const updated = items.map((it) => (it.id === item.id ? { ...it, inStock: newStatus } : it));
    setItems(updated);
    setSummary(computeLocalSummary(updated));

    // Lagre i localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('user_inventory', JSON.stringify(updated));
    }

    // Lagre i brukerens personlige dashboard
    if (dashboard && onDashboardUpdated) {
      const updatedStockMap = {
        ...dashboard.inventoryStockMap,
        [item.id]: newStatus
      };
      try {
        const updatedDashboard = await saveUserDashboard(dashboard.userId, {
          inventoryStockMap: updatedStockMap
        });
        onDashboardUpdated(updatedDashboard);
      } catch {
        // Ignorer feil
      }
    }

    // 2. Bakgrunnskall mot PATCH /api/inventory (hvis backend kjører)
    try {
      await fetch('/api/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, inStock: newStatus })
      });
    } catch {
      // Ignorer feil på statisk GitHub Pages
    }

    onInventoryUpdated?.();
  };

  // Åpne modal for å legge til ny matvare
  const handleOpenAddModal = () => {
    setEditingItem(null);
    setFormName('');
    setFormProtein(15);
    setFormKcal(120);
    setFormCategory('Tørrvarer/Belgvekster');
    setFormInStock(true);
    setFormIsCarbBase(false);
    setFormIsGutHealth(false);
    setModalError(null);
    setIsItemModalOpen(true);
  };

  // Åpne modal for å redigere eksisterende matvare
  const handleOpenEditModal = (item: InventoryItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingItem(item);
    setFormName(item.name);
    setFormProtein(item.proteinPer100g);
    setFormKcal(item.kcalPer100g);
    setFormCategory(item.category);
    setFormInStock(item.inStock);
    setFormIsCarbBase(Boolean(item.isCarbBase));
    setFormIsGutHealth(Boolean(item.isGutHealthBooster));
    setModalError(null);
    setIsItemModalOpen(true);
  };

  // Lukk modal
  const handleCloseModal = () => {
    if (isSavingItem || isDeletingItem) return;
    setIsItemModalOpen(false);
    setEditingItem(null);
    setModalError(null);
  };

  // Lagre eller oppdatere matvare (med API, offline localStorage og Dashboard sync)
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setModalError('Vennligst oppgi et matvarenavn.');
      return;
    }

    setIsSavingItem(true);
    setModalError(null);

    const generatedId = editingItem
      ? editingItem.id
      : formName
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9æøå]/gi, '-')
          .replace(/-+/g, '-');

    const itemToSave: InventoryItem = {
      id: generatedId,
      name: formName.trim(),
      proteinPer100g: Number(formProtein) || 0,
      kcalPer100g: Number(formKcal) || 0,
      category: formCategory,
      inStock: formInStock,
      isCarbBase: formIsCarbBase,
      isGutHealthBooster: formIsGutHealth,
      searchKeywords: editingItem?.searchKeywords?.length
        ? editingItem.searchKeywords
        : [formName.toLowerCase().trim()]
    };

    // 1. Optimistisk oppdatering i lokal state
    let updatedList: InventoryItem[];
    if (editingItem) {
      updatedList = items.map((it) => (it.id === editingItem.id ? itemToSave : it));
    } else {
      const exists = items.some((it) => it.id === itemToSave.id);
      if (exists) {
        updatedList = items.map((it) => (it.id === itemToSave.id ? itemToSave : it));
      } else {
        updatedList = [itemToSave, ...items];
      }
    }

    setItems(updatedList);
    setSummary(computeLocalSummary(updatedList));

    // Lagre i localStorage for frakoblet / GitHub Pages-støtte
    if (typeof window !== 'undefined') {
      localStorage.setItem('user_inventory', JSON.stringify(updatedList));
    }

    // Synkroniser med brukerens personlige dashboard
    if (dashboard && onDashboardUpdated) {
      const updatedStockMap = {
        ...dashboard.inventoryStockMap,
        [itemToSave.id]: itemToSave.inStock
      };
      try {
        const updatedDashboard = await saveUserDashboard(dashboard.userId, {
          inventoryStockMap: updatedStockMap
        });
        onDashboardUpdated(updatedDashboard);
      } catch {}
    }

    // 2. Bakgrunnskall mot backend PUT/POST /api/inventory
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert', item: itemToSave })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items) && data.items.length > 0) {
          setItems(data.items);
          setSummary(computeLocalSummary(data.items));
          if (typeof window !== 'undefined') {
            localStorage.setItem('user_inventory', JSON.stringify(data.items));
          }
        }
      }
    } catch {
      // Ignorer nettverksfeil ved statisk kjøring
    }

    setIsSavingItem(false);
    setIsItemModalOpen(false);
    setEditingItem(null);
    onInventoryUpdated?.();
  };

  // Slette matvare (med bekreftelse, API-kall og Dashboard sync)
  const handleDeleteItem = async () => {
    if (!editingItem) return;

    const confirmed = window.confirm(
      `Er du sikker på at du vil fjerne "${editingItem.name}" fra kjøkkenskapet?`
    );
    if (!confirmed) return;

    setIsDeletingItem(true);
    setModalError(null);

    // 1. Optimistisk sletting lokalt
    const updatedList = items.filter((it) => it.id !== editingItem.id);
    setItems(updatedList);
    setSummary(computeLocalSummary(updatedList));

    if (typeof window !== 'undefined') {
      localStorage.setItem('user_inventory', JSON.stringify(updatedList));
    }

    // Synkroniser fjerning med brukerens dashboard
    if (dashboard && onDashboardUpdated) {
      const updatedStockMap = { ...dashboard.inventoryStockMap };
      delete updatedStockMap[editingItem.id];
      try {
        const updatedDashboard = await saveUserDashboard(dashboard.userId, {
          inventoryStockMap: updatedStockMap
        });
        onDashboardUpdated(updatedDashboard);
      } catch {}
    }

    // 2. Kall mot backend API
    try {
      await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: editingItem.id })
      });
    } catch {
      // Ignorer nettverksfeil ved statisk kjøring
    }

    setIsDeletingItem(false);
    setIsItemModalOpen(false);
    setEditingItem(null);
    onInventoryUpdated?.();
  };

  // Beregnet proteintetthet i % av energien for sanntidsvisning i modalen
  const modalProteinRatio = useMemo(() => {
    const p = Number(formProtein) || 0;
    const k = Number(formKcal) || 0;
    if (k <= 0) return 0;
    return Math.min(100, Math.round(((p * 4) / k) * 100));
  }, [formProtein, formKcal]);

  // Filtrert liste
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedCategory !== 'Alle' && item.category !== selectedCategory) {
        return false;
      }
      if (stockFilter === 'IN_STOCK' && !item.inStock) return false;
      if (stockFilter === 'OUT_OF_STOCK' && item.inStock) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = item.name.toLowerCase().includes(q);
        const matchKeywords = item.searchKeywords?.some((k) => k.toLowerCase().includes(q));
        if (!matchName && !matchKeywords) return false;
      }

      return true;
    });
  }, [items, selectedCategory, stockFilter, searchQuery]);

  return (
    <div className={`space-y-4 max-w-4xl mx-auto ${className}`}>
      {/* 1. Header & Nøkkeltall-dashboard (Støyfritt og rent) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Kjøkkenskap & Lagerstatus
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              Huk av hva du allerede har. Handlelisten og tilbudsrutingen oppdateres umiddelbart.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            {summary && (
              <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/60 hidden sm:inline-block">
                {summary.inStock} av {summary.total} på lager ({Math.round((summary.inStock / summary.total) * 100)}%)
              </span>
            )}
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold rounded-2xl transition-all shadow-md active:scale-95 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>Ny matvare</span>
            </button>
          </div>
        </div>

        {/* Nøkkeltall-brikker */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-slate-950/70 p-3 rounded-2xl border border-slate-800 text-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Totalt i basen
              </span>
              <span className="text-xl font-black text-white block mt-0.5">{summary.total} varer</span>
            </div>

            <div className="bg-slate-950/70 p-3 rounded-2xl border border-emerald-900/40 text-center">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">
                På lager i huset
              </span>
              <span className="text-xl font-black text-emerald-400 block mt-0.5">{summary.inStock} varer</span>
            </div>

            <div className="bg-slate-950/70 p-3 rounded-2xl border border-amber-900/40 text-center">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">
                Mangler / Kjøpes
              </span>
              <span className="text-xl font-black text-amber-400 block mt-0.5">{summary.outOfStock} varer</span>
            </div>

            <div className="bg-slate-950/70 p-3 rounded-2xl border border-slate-800 text-center">
              <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider block">
                Trygghet
              </span>
              <span className="text-xl font-black text-sky-400 block mt-0.5">100% Peanøttfri</span>
            </div>
          </div>
        )}
      </div>

      {/* 2. Søkefelt, Ny Matvare-knapp & Filterpiller */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Søkefelt */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Søk i skapet (f.eks. tofu, linser, ris, spinat)..."
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-10 pr-4 py-3 text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[48px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs p-1"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status-filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-2xl self-start sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setStockFilter('ALL')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all min-h-[44px] ${
                stockFilter === 'ALL'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Alle ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setStockFilter('IN_STOCK')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all min-h-[44px] ${
                stockFilter === 'IN_STOCK'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              <span>På lager ({summary?.inStock ?? 0})</span>
            </button>
            <button
              type="button"
              onClick={() => setStockFilter('OUT_OF_STOCK')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all min-h-[44px] ${
                stockFilter === 'OUT_OF_STOCK'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <PackageX className="w-3.5 h-3.5" />
              <span>Mangler ({summary?.outOfStock ?? 0})</span>
            </button>
          </div>
        </div>

        {/* Kategori-faner */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-2 px-2 sm:mx-0 sm:px-0">
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setSelectedCategory(cat.key)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all min-h-[44px] border ${
                  isSelected
                    ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Vareliste (iPhone-vennlige min-h-[48px] kort med rediger-ikon og stor bryter) */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 flex flex-col items-center justify-center min-h-[240px]">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
          <p className="text-sm">Laster kjøkkenskapet...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 space-y-3">
          <PackageX className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-sm font-bold text-white">Ingen varer matcher filteret</p>
          <p className="text-xs text-slate-400">
            Finner du ikke varen du ser etter? Legg den til med knappen nedenfor.
          </p>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>Legg til ny matvare</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filteredItems.map((item) => {
            return (
              <div
                key={item.id}
                onClick={() => toggleInStock(item)}
                className={`cursor-pointer group select-none p-4 rounded-2xl border transition-all duration-150 flex items-center justify-between min-h-[56px] ${
                  item.inStock
                    ? 'bg-slate-900/90 border-emerald-800/60 shadow-sm'
                    : 'bg-slate-950/70 border-slate-800/80 opacity-80 hover:opacity-100'
                }`}
              >
                {/* Varenavn og detaljer */}
                <div className="space-y-0.5 min-w-0 pr-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    {item.category}
                  </span>
                  <h3 className={`font-bold text-sm truncate ${item.inStock ? 'text-white' : 'text-slate-300'}`}>
                    {item.name}
                  </h3>
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400">
                    <span>{item.proteinPer100g}g protein</span>
                    <span>•</span>
                    <span>{item.kcalPer100g} kcal</span>
                    {item.isCarbBase && <span className="text-amber-400 font-semibold">• Karbobase</span>}
                    {item.isGutHealthBooster && (
                      <span className="text-emerald-400 font-semibold">• Gut Health</span>
                    )}
                  </div>
                </div>

                {/* Handlinger: Rediger-knapp + iPhone Toggle Switch */}
                <div className="shrink-0 flex items-center gap-1.5">
                  <button
                    type="button"
                    title={`Rediger ${item.name}`}
                    onClick={(e) => handleOpenEditModal(item, e)}
                    className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>

                  <div
                    className={`w-12 h-7 rounded-full transition-colors relative flex items-center px-1 ${
                      item.inStock ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform shadow-md ${
                        item.inStock ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Modal / Bottom-Sheet: Legg til eller rediger matvare */}
      {isItemModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
          onClick={handleCloseModal}
        >
          <div
            className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
                  {editingItem ? <Pencil className="w-4 h-4" /> : <Plus className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">
                    {editingItem ? 'Rediger matvare' : 'Legg til ny matvare'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {editingItem
                      ? 'Oppdater næringsverdier, kategori eller egenskaper'
                      : 'Legges til i kjøkkenskapet og persisteres i databasen'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isSavingItem || isDeletingItem}
                className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Feilmelding */}
            {modalError && (
              <div className="p-3 rounded-2xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Skjema */}
            <form onSubmit={handleSaveItem} className="space-y-4">
              {/* Varenavn (16px input for Safari zoom) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Matvarenavn
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="f.eks. Økologisk Tofu, Svarte Bønner, Havregryn"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[48px]"
                />
              </div>

              {/* Protein & Kcal (16px inputs) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
                    <Dumbbell className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Protein (g/100g)</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    required
                    value={formProtein}
                    onChange={(e) => setFormProtein(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[48px]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5 text-amber-400" />
                    <span>Kcal (per 100g)</span>
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="1000"
                    required
                    value={formKcal}
                    onChange={(e) => setFormKcal(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[48px]"
                  />
                </div>
              </div>

              {/* Live Proteintetthet Chip */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Beregnet proteintetthet:</span>
                <span className="font-bold px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/50">
                  {modalProteinRatio}% av energien fra protein
                </span>
              </div>

              {/* Kategori-velger */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Kategori
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ITEM_CATEGORIES.map((cat) => {
                    const isSelected = formCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setFormCategory(cat)}
                        className={`px-3 py-2.5 rounded-xl text-xs font-semibold text-center transition-all min-h-[44px] border ${
                          isSelected
                            ? 'bg-emerald-950 border-emerald-500 text-emerald-300 font-bold'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Toggles / Avkrysninger for egenskaper */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                {/* På lager */}
                <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-950 border border-slate-800 cursor-pointer min-h-[48px]">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-white block">På lager i huset nå</span>
                    <span className="text-[11px] text-slate-400 block">
                      Huk av hvis du allerede har varen stående i skapet
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={formInStock}
                    onChange={(e) => setFormInStock(e.target.checked)}
                    className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                {/* Karbobase */}
                <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-950 border border-slate-800 cursor-pointer min-h-[48px]">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <Wheat className="w-3.5 h-3.5" />
                      <span>Fast Karbobase</span>
                    </span>
                    <span className="text-[11px] text-slate-400 block">
                      For f.eks. ris, quinoa, fullkornspasta, poteter og havre
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={formIsCarbBase}
                    onChange={(e) => setFormIsCarbBase(e.target.checked)}
                    className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
                  />
                </label>

                {/* Gut Health */}
                <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-950 border border-slate-800 cursor-pointer min-h-[48px]">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5" />
                      <span>Gut Health Booster</span>
                    </span>
                    <span className="text-[11px] text-slate-400 block">
                      For f.eks. fermentert mat, chiafrø, linfrø og probiotiske kilder
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={formIsGutHealth}
                    onChange={(e) => setFormIsGutHealth(e.target.checked)}
                    className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>
              </div>

              {/* Handlingsknapper */}
              <div className="flex items-center justify-between gap-3 pt-3">
                {editingItem ? (
                  <button
                    type="button"
                    onClick={handleDeleteItem}
                    disabled={isSavingItem || isDeletingItem}
                    className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-rose-950/70 border border-rose-800/60 hover:bg-rose-900 text-rose-300 font-bold text-xs transition-colors min-h-[48px]"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{isDeletingItem ? 'Sletter...' : 'Slett'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors min-h-[48px]"
                  >
                    Avbryt
                  </button>
                )}

                <button
                  type="submit"
                  disabled={isSavingItem || isDeletingItem}
                  className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-lg transition-all active:scale-98 min-h-[48px]"
                >
                  {isSavingItem ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Lagrer...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>{editingItem ? 'Oppdater matvare' : 'Lagre matvare'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
