
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { MOCK_METADATA, Icons } from './constants';
import {
  ObjectGroup,
  FileSpecification,
  ExportFormat,
  ColumnDefinition,
  TransformationStep,
  TransformationType,
  DatabaseConfig,
  FilterCondition,
  FilterOperator,
  DBType,
  FusionConfig
} from './types';
import Sidebar from './components/Sidebar';
import DataModelView from './components/DataModelView';
import TransformationPipeline from './components/TransformationPipeline';
import DatabaseConnectionModal from './components/DatabaseConnectionModal';
import ImportModelModal from './components/ImportModelModal';
import PreviewModal from './components/PreviewModal';
import FBDIImportModal from './components/FBDIImportModal';
import LoadingScreen from './components/LoadingScreen';
import { SearchableSelect } from './components/SearchableSelect';
import ExtractionProgressScreen from './components/ExtractionProgressScreen';
import FBDIAssistant from './components/FBDIAssistant';
import ManualSqlQueryModal from './components/ManualSqlQueryModal';
import LoadToInterface from './components/LoadToInterface';
import DatabaseConfigPage from './components/DatabaseConfigPage';
import {
  fetchSavedModels,
  fetchSavedModelDetail,
  analyzeFbdiMetadata,
  enrichTemplateKnowledge,
  bottomUpDiscovery
} from './services/dbService';
import { analyzeFbdiContent, AgentAnalysis } from './utils/fbdiAnalysis';
import Home from './components/Home';
import DashboardView from './components/DashboardView';
import FusionConfigPage from './components/FusionConfigPage';
import { fetchFusionConfigs } from './services/fusionService';

const App: React.FC = () => {
  const [groups, setGroups] = useState<ObjectGroup[]>([]);
  const [specifications, setSpecifications] = useState<FileSpecification[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ObjectGroup | null>(null);
  const [activeSpec, setActiveSpec] = useState<FileSpecification | null>(null);

  const [nlQuery, setNlQuery] = useState('');
  const [agentAnalysis, setAgentAnalysis] = useState<AgentAnalysis | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [fbdiLoading, setFbdiLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isFbdiModalOpen, setIsFbdiModalOpen] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [initialSyncLoading, setInitialSyncLoading] = useState(false);

  const [dbConfig, setDbConfig] = useState<DatabaseConfig | null>(null);
  const [fusionConfigs, setFusionConfigs] = useState<FusionConfig[]>([]);

  // Preview States
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewSql, setPreviewSql] = useState('');
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Extraction Progress States
  const [isExtractingMode, setIsExtractingMode] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractStatus, setExtractStatus] = useState('');
  const [isManualSqlModalOpen, setIsManualSqlModalOpen] = useState(false);
  const [isExtractDropdownOpen, setIsExtractDropdownOpen] = useState(false);

  // Routing Hooks
  const navigate = useNavigate();
  const location = useLocation();

  // Use refs to read latest groups/specs in route effect without triggering re-runs
  const groupsRef = React.useRef(groups);
  const specificationsRef = React.useRef(specifications);
  React.useEffect(() => { groupsRef.current = groups; }, [groups]);
  React.useEffect(() => { specificationsRef.current = specifications; }, [specifications]);

  // Late Selection Resolution: Re-check URL once data arrives
  useEffect(() => {
    const path = location.pathname;
    const modelMatch = path.match(/^\/fbdi\/models\/([^\/]+)(?:\/extractions\/([^\/]+))?$/);

    if (modelMatch && groups.length > 0) {
      const urlModelId = modelMatch[1];
      const urlSpecId = modelMatch[2];

      const targetGroup = groups.find(g => g.id === urlModelId);
      if (targetGroup && targetGroup.id !== selectedGroup?.id) {
        setSelectedGroup(targetGroup);
      }

      if (urlSpecId && specifications.length > 0) {
        const targetSpec = specifications.find(s => s.id === urlSpecId);
        if (targetSpec && targetSpec.id !== activeSpec?.id) {
          setActiveSpec(targetSpec);
        }
      } else if (!urlSpecId && activeSpec) {
        // Clear active specification if navigating back to a model-only URL
        setActiveSpec(null);
      }
    }
  }, [location.pathname, groups.length, specifications.length]);

  // Route & Modal State Synchronization Effect
  useEffect(() => {
    const path = location.pathname;

    // Reset all modal states first
    setIsFbdiModalOpen(false);
    setIsImportModalOpen(false);
    setIsDbModalOpen(false);
    setIsPreviewOpen(false);

    // Activate view based on route
    if (path === '/fbdi/fbdi-import') setIsFbdiModalOpen(true);
    if (path === '/fbdi/import-model') setIsImportModalOpen(true);
    // if (path === '/fbdi/database-config') setIsDbModalOpen(true);
    if (path === '/fbdi/data-preview') setIsPreviewOpen(true);

    if (path === '/fbdi/extraction-progress') setIsExtractingMode(true);
    else setIsExtractingMode(false);

    const handleOpenDbModal = () => setIsDbModalOpen(true);
    window.addEventListener('open-db-modal', handleOpenDbModal);

    if (path === '/' || path === '/fbdi') {
      setSelectedGroup(null);
      setActiveSpec(null);
    }

    return () => window.removeEventListener('open-db-modal', handleOpenDbModal);
  }, [location.pathname]);

  // Sync with DB on mount - Optimized: Background fetch, no blocking
  useEffect(() => {
    const syncWithDb = async () => {
      // NON-BLOCKING: We don't set initialSyncLoading to true here anymore
      // We'll let the sidebar show its own loading state if needed
      try {
        const { fetchSavedModels, fetchSavedModelsBulk } = await import('./services/dbService');
        const { models } = await fetchSavedModels();

        if (models.length > 0) {
          const placeholderGroups: ObjectGroup[] = models.map(model => ({
            id: `grp_db_${model.MODEL_ID}`,
            modelId: model.MODEL_ID,
            name: model.MODEL_NAME,
            databaseType: 'ORACLE',
            objects: [],
            relationships: []
          }));

          setGroups(placeholderGroups);

          // BACKGROUND BULK HYDRATION: Fetch everything in one optimized call
          console.log(`[Background] Starting bulk hydration for ${models.length} models...`);
          const modelIds = models.map(m => m.MODEL_ID);

          fetchSavedModelsBulk(modelIds).then(details => {
            if (details && details.length > 0) {
              setGroups(prev => prev.map(g => {
                const detail = details.find(d => d.group.modelId === g.modelId);
                return detail ? {
                  ...g,
                  objects: detail.group.objects,
                  relationships: detail.group.relationships || []
                } : g;
              }));

              setSpecifications(prev => {
                const bulkSpecs = details.flatMap(d => d.specifications);
                // Filter out any that might already be there (safety)
                const existingIds = new Set(prev.map(s => s.id));
                const newSpecs = bulkSpecs.filter(s => !existingIds.has(s.id));
                return [...prev, ...newSpecs];
              });
              console.log("[Background] Bulk hydration complete.");
            }
          }).catch(err => {
            console.warn("[Background] Bulk hydration failed:", err);
          });
          // No data or complete
        }
      } catch (error) {
        console.error("Database initialization failed:", error);
      }
    };

    syncWithDb();
    loadFusionConfigs();
  }, []);

  const loadFusionConfigs = async () => {
    const configs = await fetchFusionConfigs();
    setFusionConfigs(configs);
  };

  const hydrateGroup = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group || !group.modelId || (group.objects && group.objects.length > 0)) return;

    setIsAiLoading(true);
    try {
      const detail = await fetchSavedModelDetail(group.modelId);
      if (detail) {
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, objects: detail.group.objects, relationships: detail.group.relationships || [] } : g));
        setSpecifications(prev => {
          const otherSpecs = prev.filter(s => s.objectGroupId !== groupId);
          return [...otherSpecs, ...detail.specifications];
        });
        if (selectedGroup?.id === groupId) {
          setSelectedGroup({ ...group, objects: detail.group.objects, relationships: detail.group.relationships || [] });
        }
      }
    } catch (error) {
      console.error("Hydration failed:", error);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Automatically hydrate the selected group if it's missing deep data (e.g. selected via Deep Link)
  useEffect(() => {
    if (selectedGroup && selectedGroup.id.startsWith('grp_db_') && (!selectedGroup.objects || selectedGroup.objects.length === 0)) {
      hydrateGroup(selectedGroup.id);
    }
  }, [selectedGroup?.id]);

  const handleUpdateGroup = async (updatedGroup: ObjectGroup) => {
    setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
    if (selectedGroup?.id === updatedGroup.id) {
      setSelectedGroup(updatedGroup);
    }
    // Auto-save logic removed. Saving is now explicit.
  };

  const handleSaveArchitecture = async () => {
    if (!selectedGroup || !selectedGroup.modelId) return;

    setIsAiLoading(true);
    console.log(`Explicitly saving architecture for model: ${selectedGroup.name}`);
    try {
      const response = await fetch('http://localhost:3006/api/fbdi/model/update-architecture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelName: selectedGroup.name,
          objects: selectedGroup.objects,
          relationships: selectedGroup.relationships
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      alert('Architecture saved successfully!');
    } catch (err) {
      console.error("Failed to save architecture:", err);
      alert('Failed to save architecture. Check console for details.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleCreateNewSpec = (groupId?: string) => {
    const targetGroup = groupId ? groups.find(g => g.id === groupId) : selectedGroup;
    if (!targetGroup) return;

    // Try to find if any specification in this group already has a template
    const existingSpecWithTemplate = specifications.find(s => s.objectGroupId === targetGroup.id && s.backendTemplateName);

    const newSpec: FileSpecification = {
      id: `spec_${Date.now()}`,
      name: `New Extraction Task`,
      version: 1.0,
      objectGroupId: targetGroup.id,
      columns: [],
      filters: [],
      format: existingSpecWithTemplate?.format || ExportFormat.CSV,
      createdAt: new Date().toISOString(),
      backendTemplateName: existingSpecWithTemplate?.backendTemplateName,
      templateData: existingSpecWithTemplate?.templateData,
      sheetName: existingSpecWithTemplate?.sheetName
    };

    setSpecifications(prev => [...prev, newSpec]);
    setSelectedGroup(targetGroup);
    setActiveSpec(newSpec);
    navigate(`/fbdi/models/${targetGroup.id}/extractions/${newSpec.id}`);
  };

  const handleCloneSpec = async () => {
    if (!activeSpec || !selectedGroup?.modelId) return;

    console.log(`Cloning extraction '${activeSpec.name}' to a new version...`);
    setIsAiLoading(true);
    try {
      const res = await fetch('http://localhost:3006/api/fbdi/extraction/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: selectedGroup.modelId,
          extractionName: activeSpec.name,
          columns: activeSpec.columns,
          filters: activeSpec.filters,
          sqlQuery: '',
          templateName: activeSpec.backendTemplateName || 'N/A',
          sheetName: activeSpec.sheetName,
          isClone: true
        })
      });
      const result = await res.json();
      if (result.success) {
        console.log(`Cloned successfully to version ${result.version}`);
        const cloned: FileSpecification = {
          ...activeSpec,
          id: `spec_db_${Date.now()}`, // Temporary local ID, will refresh on reload
          version: result.version,
          createdAt: new Date().toISOString(),
        };
        setSpecifications(prev => [...prev, cloned]);
        setActiveSpec(cloned);
        navigate(`/fbdi/models/${selectedGroup.id}/extractions/${cloned.id}`);
        alert(`New version ${result.version} created!`);
      } else {
        alert("Failed to clone: " + result.message);
      }
    } catch (err) {
      console.error("Clone error:", err);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleDeleteSpec = (specId: string) => {
    if (confirm("Delete this extraction specification?")) {
      setSpecifications(prev => prev.filter(s => s.id !== specId));
      if (activeSpec?.id === specId) {
        setActiveSpec(null);
        navigate(`/fbdi/models/${selectedGroup?.id}`);
      }
    }
  };

  const handleAiGeneration = async () => {
    if (!nlQuery.trim()) return;
    setIsAiLoading(true);
    try {
      const response = await fetch('http://localhost:3006/api/fbdi/nl-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: nlQuery,
          metadata: groups
        })
      });
      const result = await response.json();
      if (result.objectGroupId) {
        const group = groups.find(g => g.id === result.objectGroupId) || groups[0];
        setSelectedGroup(group);
        const newSpec: FileSpecification = {
          id: `spec_ai_${Date.now()}`,
          name: result.specName || 'AI Generated Spec',
          version: 1.0,
          objectGroupId: group.id,
          columns: (result.columns || []).map((c: any, idx: number) => ({
            id: `col_${idx}`,
            sourceField: c.sourceField,
            targetName: c.targetName,
            transformations: (c.suggestedTransformations || []).map((t: string, tidx: number) => ({
              id: `tr_${tidx}`,
              type: TransformationType[t as keyof typeof TransformationType] || TransformationType.UPPERCASE
            }))
          })),
          filters: [],
          format: (result.format?.toLowerCase() as ExportFormat) || ExportFormat.CSV,
          createdAt: new Date().toISOString(),
        };
        setSpecifications(prev => [...prev, newSpec]);
        setActiveSpec(newSpec);
        setNlQuery('');
      }
    } catch (error) {
      console.error("AI Generation failed:", error);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleDbSave = async (config: DatabaseConfig) => {
    setIsAiLoading(true);
    try {
      const res = await fetch('http://localhost:3006/api/db/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setIsDbModalOpen(false);
        // Refresh configs if we are on the config page
        navigate('/fbdi/database-config');
      }
    } catch (e: any) {
      alert(`Database Error: ${e.message}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleModelImportFromFile = async (fileName: string, content: string, dialect: DBType, parsedGroup?: ObjectGroup) => {
    setIsAiLoading(true);
    try {
      let importedGroup = parsedGroup;
      if (!importedGroup) {
        throw new Error("Local model inference is disabled. Please connect to a database or provide a predefined model.");
      }

      // Feature: Module-Based Schema Lookup (Revised)
      // Query DB for tables related to this Module Name
      if (importedGroup.name) {
        try {
          const { fetchModuleSchema } = await import('./services/dbService');
          const { objects: dbObjects } = await fetchModuleSchema(dbConfig, importedGroup.name);

          if (dbObjects && dbObjects.length > 0) {
            // Replace CSV objects with DB objects entirely
            importedGroup = { ...importedGroup, objects: dbObjects };
            console.log("Hydrated group with Module Schema from DB:", importedGroup);
          } else {
            console.warn("No DB objects found for module:", importedGroup.name);
          }
        } catch (err) {
          console.error("Failed to hydrate module schema from DB:", err);
        }
      }

      setGroups(prev => [...prev, importedGroup]);
      setSelectedGroup(importedGroup);
      setIsImportModalOpen(false);
      navigate(`/fbdi/models/${importedGroup.id}`);
    } catch (e) {
      alert("Failed to parse data model.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleFbdiImport = () => {
    navigate('/fbdi/fbdi-import');
  };

  const handleFbdiSubmit = async (file: File, moduleNameOverride: string, options: { silent?: boolean, onProgress?: (msg: string, isMajor?: boolean) => void } = {}) => {
    if (!file) return;

    const updateProgress = (msg: string, progress: number, isMajor = false) => {
      if (options.onProgress) options.onProgress(msg, isMajor);
      if (!options.silent) {
        setFbdiLoading(true);
        setExtractProgress(progress);
        setExtractStatus(msg);
      }
    };

    updateProgress('Reading Template File...', 0, true);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      updateProgress('Parsing Sheet Structure...', 5);

      // 1. Module Name Assignment (Strictly use user provided name)
      let moduleName = moduleNameOverride || file.name.split('_')[0] || 'ImportedModule';

      console.log(`Final Module Name for Import: ${moduleName}`);

      // Extract raw sheet names from the Excel file (moved up for AI metadata)
      const allSheetNames = wb.SheetNames;
      const dataSheetNames = allSheetNames
        .filter(s =>
          !s.toLowerCase().includes('instruction') &&
          !s.toLowerCase().includes('hidden') &&
          !s.toLowerCase().includes('readme')
        )
        .map(name => name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());

      console.log(`Starting FBDI Import for module: ${moduleName}`);

      let dbObjects: any[] = [];
      let fbdiMappings: any[] = [];
      let relationships: any[] = [];
      const winnerTables = new Set<string>(); // Global winners for the entire template
      const sheetDiscoveries: Record<string, any[]> = {}; // Map sheetName -> discovery results

      console.log("Extracted Data Sheet Names for DB Lookup:", dataSheetNames);

      // --- Multi-Pass Header Discovery ---
      // 1. Pre-extract headers from all data sheets to support targeted discovery
      const dataSheetInfo: { name: string; headers: string[], sampleRows?: any[][] }[] = [];
      dataSheetNames.forEach(sheetName => {
        const actualSheetName = wb.SheetNames.find(n => n.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === sheetName);
        if (!actualSheetName) return;
        const ws = wb.Sheets[actualSheetName];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const rows = data as any[][];

        let headers: string[] = [];
        let headerInfos: string[] = [];

        // Harvest technical metadata from rows 1-3
        const row1 = rows[0] as any[]; // Table Name (often common to sheet)
        const row2 = rows[1] as any[]; // Internal Column Name
        const row3 = rows[2] as any[]; // Column Properties / Comments
        const row4 = rows[3] as any[]; // Display Name (Actual Headers)

        if (row4 && Array.isArray(row4)) {
          const vCols = row4.filter(c => c && (typeof c === 'string' || typeof c === 'number') && String(c).trim().length > 0).length;
          if (vCols > 0) {
            headers = row4.map(r => r ? String(r).trim() : '');
            // Create technical descriptions for each header
            headerInfos = headers.map((h, idx) => {
              const internal = row2 && row2[idx] ? String(row2[idx]).trim() : '';
              const techInfo = row3 && row3[idx] ? String(row3[idx]).trim() : '';
              const tbl = row1 && row1[0] ? String(row1[0]).trim() : '';

              // NEW: Extract Comments (Bubble Text)
              const colLetter = XLSX.utils.encode_col(idx);
              const headerCellAddress = `${colLetter}4`; // Row 4 (1-indexed)
              const headerCell = ws[headerCellAddress];
              let comment = '';
              if (headerCell?.c && Array.isArray(headerCell.c)) {
                comment = headerCell.c.map((c: any) => c.t || '').join(' ').trim();
              } else if (headerCell?.c && typeof headerCell.c === 'object') {
                comment = (headerCell.c as any).t || '';
              }

              if (!h && !internal && !techInfo && !comment) return '';

              const parts = [];
              if (internal) parts.push(`Internal Column: ${internal}`);

              if (techInfo) {
                // Smart Split for DataType and Description
                // Common FBDI row 3 format: "DATATYPE(LENGTH) Description text"
                const techParts = techInfo.split(' ');
                const firstPart = techParts[0].toUpperCase();
                const isProbablyDataType = firstPart.includes('CHAR') || firstPart.includes('NUMBER') || firstPart.includes('DATE') || firstPart.includes('TIMESTAMP');

                if (isProbablyDataType) {
                  parts.push(`DataType: ${techParts[0]}`);
                  if (techParts.length > 1) {
                    parts.push(`Description: ${techParts.slice(1).join(' ')}`);
                  }
                } else {
                  parts.push(`Technical Info: ${techInfo}`);
                }
              }

              if (comment) parts.push(`Header Comment: ${comment}`);
              if (tbl) parts.push(`Associated Table: ${tbl}`);

              return parts.join(' | ');
            });
          }
        }

        let sampleRows: any[][] = [];

        if (!headers || headers.length === 0) {
          const scanLimit = Math.min(rows.length, 20);
          let mCols = 0;
          for (let i = 0; i < scanLimit; i++) {
            const row = rows[i] as any[];
            if (!row || !Array.isArray(row)) continue;
            const vCols = row.filter(c => c && (typeof c === 'string' || typeof c === 'number') && String(c).trim().length > 0).length;
            if (vCols > mCols) {
              mCols = vCols;
              headers = row.map(r => r ? String(r).trim() : '');
              sampleRows = rows.slice(i + 1, i + 6).filter(r => Array.isArray(r)) as any[][];

              // NEW: Populate headerInfos even in fallback path by looking at rows above the headers
              const iRow = i > 1 ? rows[i - 2] : [];
              const tRow = i > 0 ? rows[i - 1] : [];
              const bRow = i > 2 ? rows[i - 3] : [];

              headerInfos = headers.map((h, idx) => {
                const internal = iRow && iRow[idx] ? String(iRow[idx]).trim() : '';
                const tech = tRow && tRow[idx] ? String(tRow[idx]).trim() : '';
                const tbl = bRow && bRow[0] ? String(bRow[0]).trim() : '';

                // NEW: Extract Comments in fallback path
                const colLetter = XLSX.utils.encode_col(idx);
                const headerCellAddress = `${colLetter}${i + 1}`;
                const headerCell = ws[headerCellAddress];
                let comment = '';
                if (headerCell?.c && Array.isArray(headerCell.c)) {
                  comment = headerCell.c.map((c: any) => c.t || '').join(' ').trim();
                } else if (headerCell?.c && typeof headerCell.c === 'object') {
                  comment = (headerCell.c as any).t || '';
                }

                if (!h && !internal && !tech && !comment) return '';
                const parts = [];
                if (internal) parts.push(`Internal Column: ${internal}`);
                if (tech) parts.push(`Technical Info: ${tech}`);
                if (comment) parts.push(`Header Comment: ${comment}`);
                if (tbl) parts.push(`Associated Table: ${tbl}`);
                return parts.join(' | ');
              });
            }
          }
        } else {
          if (rows.length > 4) {
            sampleRows = rows.slice(4, 9).filter(r => Array.isArray(r)) as any[][];
          }
        }
        dataSheetInfo.push({ name: actualSheetName, headers, headerInfos, sampleRows } as any);
      });

      updateProgress(`Found ${dataSheetInfo.length} data sheets. Starting AI context analysis...`, 15);

      // --- PHASE 1a: AI Analysis (Sequential for context) ---
      const displayName = moduleNameOverride || file.name.replace(/\.[^/.]+$/, "");
      let calculatedModule = displayName;

      console.log("Analyzing FBDI Metadata to establish context...");
      const metadataForAnalysis = {
        sheetNames: allSheetNames,
        instructions: '',
        props: (wb.Props || {}) as any,
        fileName: file.name,
        sheetDetails: dataSheetInfo
      };

      const instSheet = wb.SheetNames.find(n => n.toLowerCase().includes('instruction'));
      if (instSheet) {
        const ws = wb.Sheets[instSheet];
        metadataForAnalysis.instructions = String(ws['A1']?.v || ws['B2']?.v || '').substring(0, 1000);
      }

      const analysis = await analyzeFbdiMetadata(metadataForAnalysis).catch(err => {
        console.warn("AI Analysis failed:", err);
        return null;
      });

      updateProgress('Context established. Starting Technical Table Discovery...', 30);

      // Process Analysis Results
      let analysisIntent = '';
      if (analysis) {
        calculatedModule = analysis.moduleName || calculatedModule;
        analysisIntent = analysis.intent || '';

        setAgentAnalysis({
          productFamily: analysis.productFamily,
          moduleName: analysis.moduleName,
          possibleModules: analysis.possibleModules,
          mainObject: analysis.mainObject,
          intent: analysis.intent,
          confidence: analysis.confidence,
          summary: analysis.reasoning,
          sheets: allSheetNames
        } as any);

        // Background Enrichment (Non-blocking)
        enrichTemplateKnowledge({
          templateName: file.name,
          productFamily: analysis.productFamily || 'Oracle Fusion',
          moduleName: calculatedModule,
          intent: analysisIntent,
          instructions: metadataForAnalysis.instructions,
          sheetDetails: dataSheetInfo.map(ds => ({
            name: ds.name,
            description: ds.name,
            headers: ds.headers,
            headerInfos: (ds as any).headerInfos,
            sampleRows: ds.sampleRows
          }))
        }).catch(e => console.warn("Background enrichment failed:", e));
      }

      // --- PHASE 1b: Discovery (Context-Aware) ---
      console.log(`Starting discovery with context: ${calculatedModule}`);
      const discoveryResults = await Promise.all(dataSheetInfo.map(async (ds) => {
        try {
          console.log(`Searching nominees for sheet: ${ds.name}...`);
          const disc = await bottomUpDiscovery(ds.name, ds.headers, (ds as any).headerInfos, calculatedModule, analysisIntent);
          console.log(`Discovery results for sheet: ${ds.name}`, disc);
          return { sheetName: ds.name, disc };
        } catch (err) {
          console.warn(`Discovery failed for sheet: ${ds.name}`, err);
          return { sheetName: ds.name, disc: null };
        } finally {
          // Increment progress slightly for each sheet discovery
          if (!options.silent) setExtractProgress(prev => Math.min(prev + (30 / dataSheetInfo.length), 60));
        }
      }));

      updateProgress('Nominees identified. Hydrating metadata from Database...', 65);

      // Update moduleName for internal mapping logic to use DISPLAY name for group
      moduleName = displayName;

      // Collect winner tables from AI-ranked results
      discoveryResults.forEach(({ sheetName, disc }) => {
        if (disc && disc.success && Array.isArray(disc.aiRankedTables)) {
          sheetDiscoveries[sheetName] = disc.discoveries;
          disc.aiRankedTables.forEach((tbl: string) => {
            winnerTables.add(tbl.toUpperCase());
          });
        }
      });

      // NEW: Metadata Signal Scan - Proactively identify tables mentioned in technical hints
      const metadataTables = new Set<string>();
      dataSheetInfo.forEach(ds => {
        const infos = (ds as any).headerInfos || [];
        infos.forEach((info: string) => {
          const tableMatch = info.match(/ASSOCIATED TABLE:\s*([A-Z0-9_]+)/i);
          if (tableMatch) metadataTables.add(tableMatch[1].trim().toUpperCase());

          // Also check for implicitly mentioned tables in row 1 if row 1 was captured as associated table
          const tblPart = info.split(' | ').find(p => p.startsWith('Associated Table:'));
          if (tblPart) {
            const tName = tblPart.split(':')[1]?.trim().toUpperCase();
            if (tName) metadataTables.add(tName);
          }
        });
      });

      const tablesToFetch = Array.from(new Set([...winnerTables, ...metadataTables]));
      if (tablesToFetch.length > 0) {
        console.log(`[Evidence-Led Hydration] Fetching details for ${tablesToFetch.length} winner tables:`, tablesToFetch.join(', '));

        const [detailsRes] = await Promise.all([
          fetch(`http://localhost:3006/api/fbdi/discovery/table-details?tables=${tablesToFetch.join(',')}`)
        ]);

        const [details] = await Promise.all([detailsRes.json()]);

        if (details && details.success) dbObjects = details.objects;
        // Relationships are now deferred to Phase 4 for speed optimization
      }

      if (!dbObjects || dbObjects.length === 0) {
        console.warn("No evidence-backed tables identified. Architecture may be empty.");
      } else {
        console.log("Hydrated Source Architecture:", dbObjects.map(o => o.name));
      }

      // 4. Create ID for this FBDI Module Group
      const groupId = `grp_fbdi_${Date.now()}`;

      // Upload template...
      updateProgress('Staging template on server for extraction...', 80);
      console.log("Uploading FBDI template to server...");
      let backendTemplateName = '';
      let fbdiStructure = null;
      try {
        const formData = new FormData();
        formData.append('template', file);
        const uploadRes = await fetch('http://localhost:3006/api/fbdi/upload-template', {
          method: 'POST',
          body: formData
        });
        const uploadResult = await uploadRes.json();
        if (uploadResult.success) {
          backendTemplateName = uploadResult.filename;
          fbdiStructure = uploadResult.fbdiStructure;
          console.log("Template staged successfully:", backendTemplateName);
        }
      } catch (err) {
        console.error("Template upload failed", err);
      }

      const wbBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const newSpecs: FileSpecification[] = [];

      const allUnmappedMandatory: Record<string, { header: string; info: string }[]> = {};
      const intermediateSpecs: { dsInfo: any; specId: string; mappedColumns: ColumnDefinition[] }[] = [];

      updateProgress('Consolidating mappings and establishing Architecture...', 90);

      dataSheetInfo.forEach(ds => {
        const actualSheetName = ds.name;
        const cleanSheetName = actualSheetName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const headers = ds.headers;
        const headerInfos = (ds as any).headerInfos || [];

        const specId = `spec_${actualSheetName}_${Date.now()}`;

        // NEW: Calculate per-sheet winner tables based on coverage and AI-driven functional intent
        const discoveryRes = discoveryResults.find(dr => dr.sheetName === actualSheetName);
        const aiRankedTables = (discoveryRes?.disc as any)?.aiRankedTables || [];

        const sheetScores = dbObjects.map(obj => {
          let score = 0;
          const objName = (obj.tableName || '').toUpperCase();
          const cleanSheet = actualSheetName.toUpperCase().replace(/[^A-Z0-9]/g, '');

          // 1. Literal Intent Match: Table name matches sheet keywords
          if (objName.includes(cleanSheet) || cleanSheet.includes(objName)) score += 60;

          // 2. AI-Driven Functional Intent Match: (Replaces hardcoded PO_/AP_ etc.)
          // If the AI identified this table as a top functional match for the intent/sheet
          const aiRank = aiRankedTables.indexOf(objName);
          if (aiRank !== -1) {
            // Position-based boost: 0 -> 50, 1 -> 45, etc.
            score += Math.max(0, 50 - (aiRank * 5));
          }

          // 3. Column Coverage Match: Check how many columns in this table match the headers
          let coverage = 0;
          headers.forEach((h, idx) => {
            const hClean = h.replace(/[*]+/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const hInfo = (headerInfos[idx] || '').toUpperCase();
            const colNameMatch = hInfo.match(/COLUMN NAME:\s*([A-Z0-9_]+)\*?/i);
            const commentHint = colNameMatch ? colNameMatch[1].replace(/\*+$/, '').trim() : null;

            const cols = obj.columns || obj.fields || [];
            const hasDirectMatch = cols.some((f: any) => {
              const fName = (f.name || '').toUpperCase();
              return fName === hClean || fName === commentHint;
            });
            if (hasDirectMatch) coverage++;
          });
          score += (coverage * 15);

          return { obj, score, coverage };
        }).sort((a, b) => b.score - a.score);

        const sheetWinnerTables = new Set(sheetScores.filter(s => s.score > 0).slice(0, 5).map(s => s.obj.tableName.toUpperCase()));
        console.log(`[Consolidation Pass] Sheet: ${actualSheetName} | Primary Candidates:`, Array.from(sheetWinnerTables));

        const primaryTable = sheetScores.length > 0 ? sheetScores[0].obj.tableName.toUpperCase() : null;
        console.log(`[Strict Mapping] Forcing all mappings for ${actualSheetName} to Primary Table: ${primaryTable}`);

        // Define a restricted list of DB objects to force single-table mapping
        const primaryOnlyDbObjects = primaryTable 
          ? dbObjects.filter(o => o.tableName.toUpperCase() === primaryTable)
          : dbObjects;

        const unmappedMandatory: { header: string, info: string }[] = [];
        const usedTablesInSheet = new Set<string>();
        const mappedColumns = headers.map((h, i) => {
          let bestMatch = '';
          let mappingMatch: any = null;
          const hClean = h.replace(/[*]+/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          const isMandatory = h.includes('*') || h.includes('**');

          // TIER 0: Direct & Technical Discovery (Priority 0)
          const hInfo = (headerInfos[i] || '').toUpperCase();
          const internalMatch = hInfo.match(/(?:INTERNAL COLUMN|COLUMN NAME|TECHNICAL NAME)\s*[:=-]?\s*([A-Z0-9\._\- ]+)/i);
          const internalHint = internalMatch ? internalMatch[1].trim().toUpperCase().replace(/\s+/g, '_') : null;

          const commentMatch = hInfo.match(/HEADER COMMENT:\s*(.*)/i);
          const commentFull = commentMatch ? commentMatch[1].trim().toUpperCase() : "";
          // Primary: Look for explicit column name patterns in the metadata
          // Broadened regex to catch more variations, spaces, and special technical chars
          const colNameMatch = commentFull.match(/(?:COLUMN NAME|INTERNAL COLUMN|MAPPED TO|FIELD NAME|TECHNICAL NAME)\s*[:=-]?\s*([A-Z0-9\._\- ]+)/i);
          // Fallback: Look for any underscore-containing word that looks like a DB column
          const commentWords = commentFull.split(/[^A-Z0-9\._\-]/).filter(sw => sw.length >= 3);
          const commentHint = colNameMatch ? colNameMatch[1].replace(/\*+$/, '').trim().toUpperCase().replace(/\s+/g, '_') : (commentWords.find(sw => sw.includes('_')) || commentWords[0] || null);

          if (internalHint || commentHint) {
            console.log(`[Tier 0: Setup] Header '${h}' Hints -> Internal: ${internalHint}, Comment: ${commentHint}`);
          }

          // Pre-calculate strict vs normalized hints for Priority 1
          const strictInternalHint = internalMatch ? internalMatch[1].trim().toUpperCase() : null;
          const normalizedInternalHint = internalHint; // Already uppercase and snake_case
          const strictCommentHint = colNameMatch ? colNameMatch[1].replace(/\*+$/, '').trim().toUpperCase() : null;
          const normalizedCommentHint = commentHint; // Already uppercase and snake_case


          const tableMatch = hInfo.match(/ASSOCIATED TABLE:\s*([A-Z0-9_]+)/i);
          const tableHint = tableMatch ? tableMatch[1].trim().toUpperCase() : null;

          const synonymMap: { [key: string]: string[] } = {
            'SUPPLIER': ['VENDOR', 'PARTY', 'SUPPLIER'],
            'VENDOR': ['SUPPLIER', 'PARTY', 'VENDOR'],
            'BU': ['BUSINESS UNIT', 'BU', 'OPERATING_UNIT'],
            'ORG': ['ORGANIZATION', 'ORG'],
            'REQ': ['REQUISITION', 'REQ'],
            'PO': ['PURCHASE ORDER', 'PO'],
            'DT': ['DATE', 'DT', 'TIME'],
            'ADDRESS': ['SITE', 'LOCATION', 'PARTY_SITE', 'ADDRESS'],
            'AGENT': ['BUYER', 'PROCUREMENT_OFFICER', 'AGENT'],
            'BUYER': ['AGENT', 'PROCUREMENT_OFFICER', 'BUYER'],
            'QTY': ['QUANTITY', 'VOLUME', 'QTY'],
            'AMT': ['AMOUNT', 'TOTAL', 'VALUE', 'AMT'],
            'UOM': ['UNIT OF MEASURE', 'UNIT', 'UOM'],
            'TAX': ['VAT', 'GST', 'DUTY', 'TAX'],
            'SITE': ['ADDRESS', 'LOCATION', 'PARTY_SITE', 'SITE'],
            'CURRENCY': ['CURR'],
            'CURR': ['CURRENCY'],
            'IDENTIFIER': ['ID'],
            'ID': ['IDENTIFIER'],
            'PARTY': ['SUPPLIER', 'VENDOR', 'PARTY'],
            'LOCATION': ['ADDRESS', 'SITE', 'PARTY_SITE', 'LOCATION'],
            'ITEM': ['PART', 'ITEM'],
            'PART': ['ITEM', 'PART']
          };

          const getSynonyms = (term: string) => {
            const up = term.toUpperCase();
            const syns = [up];
            Object.keys(synonymMap).forEach(key => {
              if (up.includes(key)) {
                synonymMap[key].forEach(s => syns.push(up.replace(key, s)));
              }
            });
            return [...new Set(syns)];
          };

          // Priority 1: Exact Metadata Match (Comment or Internal Hint)
          // NEW: Try strict hints (exactly as written) before normalized hints
          const tryHints = [strictCommentHint, strictInternalHint, normalizedCommentHint, normalizedInternalHint]
            .filter(Boolean)
            .filter((v, idx, self) => self.indexOf(v) === idx); // Unique only


          for (const rawHint of tryHints) {
            if (bestMatch) break;

            const hSyns = getSynonyms(rawHint);
            for (const mappingHint of hSyns) {
              if (bestMatch) break;

              const hDigitsMatch = mappingHint!.match(/\d+$/);
              const hDigits = hDigitsMatch ? hDigitsMatch[0] : null;

              const matches = primaryOnlyDbObjects.filter(obj => {
                const cols = obj.columns || obj.fields || [];
                return cols.some((f: any) => {
                  const fName = (f.name || '').toUpperCase();
                  if (hDigits) {
                    const fDigitsMatch = fName.match(/\d+$/);
                    const fDigits = fDigitsMatch ? fDigitsMatch[0] : null;
                    if (hDigits !== fDigits) return false;
                  }
                  return fName === mappingHint;
                });
              });

              if (matches.length > 0) {
                let sortedMatches = [...matches];

                // Prioritize standard ATTRIBUTE prefix over suffixed ones
                if (mappingHint!.startsWith('ATTRIBUTE')) {
                  sortedMatches.sort((a, b) => {
                    const aCol = (a.columns || a.fields || []).find((f: any) => (f.name || '').toUpperCase() === mappingHint);
                    const bCol = (b.columns || b.fields || []).find((f: any) => (f.name || '').toUpperCase() === mappingHint);
                    const aStarts = (aCol?.name || '').toUpperCase().startsWith('ATTRIBUTE') ? 0 : 1;
                    const bStarts = (bCol?.name || '').toUpperCase().startsWith('ATTRIBUTE') ? 0 : 1;
                    return aStarts - bStarts;
                  });
                }

                let chosenObj = null;
                if (tableHint) chosenObj = sortedMatches.find(m => (m.tableName || '').toUpperCase() === tableHint);

                // NEW: ABSOLUTE PRIORITY - If the Primary Table for this sheet has this column, use it immediately
                if (!chosenObj && aiRankedTables.length > 0) {
                  const primaryTable = aiRankedTables[0].toUpperCase();
                  const primaryInMatches = sortedMatches.find(m => (m.tableName || '').toUpperCase() === primaryTable);
                  if (primaryInMatches) {
                    chosenObj = primaryInMatches;
                    console.log(`[Tier 0: Priority Match] Selected Primary Table: ${primaryTable} for Hint: ${mappingHint}`);
                  }
                }

                // COHESION BOOST: Prefer tables already used in this sheet
                if (!chosenObj && usedTablesInSheet.size > 0) {
                  const usedInMatches = sortedMatches.find(m => usedTablesInSheet.has((m.tableName || '').toUpperCase()));
                  if (usedInMatches) {
                    chosenObj = usedInMatches;
                    console.log(`[Tier 0: Cohesion Match] Selected Already-Used Table: ${chosenObj.tableName} for Hint: ${mappingHint}`);
                  }
                }

                // PRIORITY: Pick the table with the highest AI/Coverage score from sheetWinnerTables
                if (!chosenObj) {
                  const winnersInMatches = sortedMatches
                    .filter(m => sheetWinnerTables.has((m.tableName || '').toUpperCase()))
                    .map(m => {
                      const scoreObj = sheetScores.find(s => s.obj.tableName.toUpperCase() === m.tableName.toUpperCase());
                      return { obj: m, score: scoreObj?.score || 0 };
                    })
                    .sort((a, b) => b.score - a.score);

                  // If we have AI-ranked winners, pick the top one
                  if (winnersInMatches.length > 0) {
                    chosenObj = winnersInMatches[0].obj;
                  }
                }

                // SECONDARY: Pick a table that was successful in global discovery
                if (!chosenObj) chosenObj = sortedMatches.find(m => winnerTables.has((m.tableName || '').toUpperCase()));

                if (!chosenObj) {
                  const sClean = actualSheetName.toUpperCase().replace(/[^A-Z0-9]/g, '');
                  chosenObj = sortedMatches.find(m => m.tableName.toUpperCase().includes(sClean) || sClean.includes(m.tableName.toUpperCase()));
                }

                // Semantic module rules REMOVED - fully AI-driven via sheetScores/sheetWinnerTables above

                const matchedCol = (chosenObj.columns || chosenObj.fields || []).find((f: any) => (f.name || '').toUpperCase() === mappingHint);
                if (matchedCol) {
                  bestMatch = `${chosenObj.tableName}.${matchedCol.name}`;
                  console.log(`[Tier 0: Metadata Match] Header '${h}' -> ${bestMatch} (Type: ${mappingHint === commentHint ? 'Comment' : 'Internal'}, Hint: ${mappingHint})`);
                }
              }
            }
          }

          // NEW TIER 1.5: Primary Table Literal Match (Forced Scope)
          // Before falling into Discovery, check if the header exactly matches a column in the primary table.
          if (!bestMatch && primaryTable) {
            const primaryObj = primaryOnlyDbObjects.find(o => o.tableName.toUpperCase() === primaryTable);
            if (primaryObj) {
              const cols = primaryObj.columns || primaryObj.fields || [];
              const matchedCol = cols.find((f: any) => {
                const fName = (f.name || '').toUpperCase();
                const fNameClean = fName.replace(/_/g, '');
                return fName === hClean || fNameClean === hClean || fName === h.toUpperCase().replace(/\s+/g, '_');
              });

              if (matchedCol) {
                bestMatch = `${primaryObj.tableName}.${matchedCol.name}`;
                console.log(`[Tier 1.5: Primary Literal Match] Header '${h}' -> ${bestMatch}`);
              }
            }
          }

          // Priority 2 within Tier 0: Synonym/literal match
          if (!bestMatch) {
            const hSyns = getSynonyms(hClean);
            const hHasDigits = /\d+$/.test(hClean);
            const hDigits = hHasDigits ? hClean.match(/\d+$/)?.[0] : null;

            for (const target of hSyns) {
              // If it's a generic attribute, don't allow synonym fuzzy matching
              if (hClean.includes('ATTRIBUTE') || hClean.includes('GLOBAL')) {
                // Only allow exact match if it has digits
                if (hHasDigits && target !== hClean) continue;
              }

              const matchedObj = primaryOnlyDbObjects.find(obj => {
                const cols = obj.columns || obj.fields || [];
                return cols.some((f: any) => {
                  const fName = (f.name || '').toUpperCase();
                  if (hDigits) {
                    const fDigits = fName.match(/\d+$/)?.[0];
                    if (hDigits !== fDigits) return false;
                  }
                  return fName === target;
                });
              });
              if (matchedObj) {
                const matchedCol = (matchedObj.columns || matchedObj.fields || []).find((f: any) => (f.name || '').toUpperCase() === target);
                if (matchedCol) {
                  bestMatch = `${matchedObj.tableName}.${matchedCol.name}`;
                  console.log(`[Tier 0: Synonym Match] Header '${h}' -> ${bestMatch} (Synonym: ${target})`);
                  break;
                }
              }
            }
          }

          // TIER 1: Bottom-Up Discovery Match (Semantic Evidence - Priority 1)
          // RESTRICTION: Only use semantic discovery for mandatory fields (* or **)
          if (!bestMatch && isMandatory) {
            const sheetMatches = sheetDiscoveries[actualSheetName] || [];
            const discoveryMatch = sheetMatches.find((m: any) => m.idx === i);

            if (discoveryMatch && discoveryMatch.matches && discoveryMatch.matches.length > 0) {
              const topMatch = discoveryMatch.matches[0];
              if (topMatch.distance < 0.40) { // High confidence metric
                // Verification: If it's an attribute column, ensure it's not a digit mismatch
                const hDigitsMatch = hClean.match(/\d+$/);
                const colDigitsMatch = topMatch.columnName.toUpperCase().match(/\d+$/);

                if (hDigitsMatch && colDigitsMatch && hDigitsMatch[0] !== colDigitsMatch[0]) {
                  console.log(`[Tier 2 Discovery Skip] Digit mismatch: Header ${hClean} vs Column ${topMatch.columnName}`);
                } else {
                  let bestDiscoveryMatch = topMatch;
                  if (discoveryMatch.matches.length > 1) {
                    const hWords = h.toUpperCase().split(/[^A-Z]/).filter(w => w.length >= 3);
                    const relevantCandidates = discoveryMatch.matches.slice(0, 8);

                    // ERP-Common words that shouldn't carry full weight
                    const commonErpWords = ['FLAG', 'CODE', 'OVERRIDE', 'ID', 'DATE', 'TYPE', 'VAL', 'VALUE', 'NAME', 'DESC', 'DESCRIPTION', 'STATUS', 'INDICATOR', 'FIELD'];

                    let bestScore = -1000;
                    for (const cand of relevantCandidates) {
                      const candName = cand.columnName.toUpperCase();
                      const candObj = dbObjects.find(o => (o.tableName || '').toUpperCase() === cand.tableName.toUpperCase());
                      const candCol = candObj?.columns?.find((f: any) => (f.name || '').toUpperCase() === candName);
                      const candDesc = (candCol?.description || '').toUpperCase();

                      let score = 0;
                      hWords.forEach(w => {
                        const isCommon = commonErpWords.includes(w);
                        const weightMult = isCommon ? 0.2 : 1.0;

                        if (candName.includes(w)) score += (5 * weightMult);
                        else if (candDesc.includes(w)) score += (2 * weightMult);
                      });

                      // Semantic synonym scores (High Quality Matches)
                      const hUpper = h.toUpperCase();
                      if (hUpper.includes('SUPPLIER') && (candName.includes('VENDOR') || candDesc.includes('VENDOR'))) score += 10;
                      if (hUpper.includes('VENDOR') && (candName.includes('SUPPLIER') || candDesc.includes('SUPPLIER'))) score += 10;
                      if (hUpper.includes('BUYER') && (candName.includes('AGENT') || candDesc.includes('AGENT'))) score += 10;
                      if (hUpper.includes('NAME') && (candName.includes('DESC') || candDesc.includes('DESC'))) score += 6;

                      // Rank 1 Protection: If the semantic distance is exceptional, give it a major boost
                      const matchIndex = discoveryMatch.matches.indexOf(cand);
                      if (matchIndex === 0 && cand.distance < 0.20) {
                        score += 15;
                      }

                      // NEW: Primary AI Ranking Boost - Strongest signal
                      if (aiRankedTables.length > 0 && cand.tableName.toUpperCase() === aiRankedTables[0].toUpperCase()) {
                        score += 30; // Massive boost for the primary sheet table
                      } else if (aiRankedTables.includes(cand.tableName.toUpperCase())) {
                        score += 10; // Moderate boost for secondary AI ranked tables
                      }

                      // COHESION BOOST: Prefer tables already used in this sheet
                      if (usedTablesInSheet.has(cand.tableName.toUpperCase())) {
                        score += 12; // High priority for already-selected context
                      }

                      // Distance penalty (weighted) - More aggressive to favor vector similarity
                      const finalScore = score - (cand.distance * 40);

                      if (finalScore > bestScore) {
                        bestScore = finalScore;
                        bestDiscoveryMatch = cand;
                      }
                    }
                  }


                  const matchedObj = primaryOnlyDbObjects.find(o => (o.tableName || '').toUpperCase() === bestDiscoveryMatch.tableName.toUpperCase());
                  if (matchedObj) {
                    const cols = matchedObj.columns || matchedObj.fields || [];
                    if (cols.some((f: any) => (f.name || '').toUpperCase() === bestDiscoveryMatch.columnName.toUpperCase())) {
                      bestMatch = `${matchedObj.tableName}.${bestDiscoveryMatch.columnName}`;
                      console.log(`[Tier 2: Discovery Match] Header '${h}' -> ${bestMatch} (Dist: ${bestDiscoveryMatch.distance}, Rank: ${discoveryMatch.matches.indexOf(bestDiscoveryMatch) + 1})`);
                    }
                  }
                }
              }
            }
          }
          // TIER 2: Local Fallback (Literal & Keyword - Priority 2)
          // RESTRICTION: Skip automated keyword "guessing" for non-mandatory fields.
          if (!bestMatch && isMandatory) {
            const hDigitsMatch = hClean.match(/\d+$/);
            const hDigits = hDigitsMatch ? hDigitsMatch[0] : null;

            // Always search primaryOnlyDbObjects
            const sortedDbObjs = [...primaryOnlyDbObjects].sort((a, b) => {
              if (usedTablesInSheet.has(a.tableName.toUpperCase()) && !usedTablesInSheet.has(b.tableName.toUpperCase())) return -1;
              if (!usedTablesInSheet.has(a.tableName.toUpperCase()) && usedTablesInSheet.has(b.tableName.toUpperCase())) return 1;

              if (aiRankedTables.length === 0) return 0;
              const aRank = aiRankedTables.indexOf(a.tableName.toUpperCase());
              const bRank = aiRankedTables.indexOf(b.tableName.toUpperCase());
              if (aRank === -1 && bRank === -1) return 0;
              if (aRank === -1) return 1;
              if (bRank === -1) return -1;
              return aRank - bRank;
            });

            for (const obj of sortedDbObjs) {
              const cols = obj.columns || obj.fields || [];
              const matchedField = cols.find((f: any) => {
                const fName = (f.name || '').toUpperCase();
                const fNameClean = fName.replace(/[^a-zA-Z0-9]/g, '');

                // If header or field has digits, enforce exact digit match
                if (hDigits) {
                  const fDigitsMatch = fName.match(/\d+$/);
                  const fDigits = fDigitsMatch ? fDigitsMatch[0] : null;
                  if (hDigits !== fDigits) return false;
                }

                // For attributes, only allow more strict matching
                if (hClean.includes('ATTRIBUTE')) {
                  return fNameClean === hClean;
                }

                return fNameClean === hClean || hClean.includes(fNameClean) || fNameClean.includes(hClean);
              });
              if (matchedField) {
                bestMatch = `${obj.tableName}.${matchedField.name}`;
                console.log(`[Tier 3: Literal Match] Header '${h}' -> ${bestMatch}`);
                break;
              }
            }

            // Semantic check (Local metadata - Primary Table Only)
            if (!bestMatch) {
              const hInfo = headerInfos[i] || '';
              const searchString = `${h} ${hInfo}`.toLowerCase();
              const hWords = searchString.split(' ').filter(w => w.length > 3);

              for (const obj of primaryOnlyDbObjects) {
                const cols = obj.columns || obj.fields || [];
                const matchedField = cols.find((f: any) => {
                  const dbDesc = (f.description || f.dataType || '').toLowerCase();
                  return hWords.length > 0 && hWords.every(word => dbDesc.includes(word));
                });
                if (matchedField) {
                  bestMatch = `${obj.tableName}.${matchedField.name}`;
                  console.log(`[Tier 3: local Keyword Match] Header '${h}' -> ${bestMatch}`);
                  break;
                }
              }
            }
          }

          // FINAL COHESION FILTER: Strictly enforce Primary Table
          if (bestMatch) {
            const matchTable = bestMatch.split('.')[0].toUpperCase();
            if (primaryTable && matchTable !== primaryTable) {
              console.log(`[Strict Mapping] Discarding cross-table match for Header: '${h}' -> ${bestMatch}. Reason: Restricted to ${primaryTable}.`);
              bestMatch = '';
            }
          }

          if (bestMatch) {
            const tbl = bestMatch.split('.')[0].toUpperCase();
            usedTablesInSheet.add(tbl);
          }

          if (!bestMatch && isMandatory) {
            unmappedMandatory.push({ header: h, info: headerInfos[i] || '' });
          }

          return {
            id: `col_${cleanSheetName}_${i}_${Date.now()}`,
            targetName: h,
            sourceField: bestMatch || '',
            transformations: [],
            confidenceScore: bestMatch ? 100 : 0,
            reasoning: bestMatch ? 'Matched via Local Metadata' : 'Pending AI Discovery'
          } as ColumnDefinition;
        });

        if (unmappedMandatory.length > 0) allUnmappedMandatory[actualSheetName] = unmappedMandatory;
        intermediateSpecs.push({ dsInfo: ds, specId, mappedColumns });
      });

      // --- PHASE 3: Global Discovery REMOVED for Performance ---
      // Discovery is now fully evidence-led and relies on the semantic winners identified in Phase 2.

      intermediateSpecs.forEach(is => {
        const { dsInfo, specId, mappedColumns } = is;
        const autoFilters: FilterCondition[] = [];

        // Generate filters by mapping each sample data value to its corresponding DB column.
        // Each row in sampleRows corresponds to the header columns, so row[i] is the value for mappedColumns[i].
        if (dsInfo.sampleRows && Array.isArray(dsInfo.sampleRows)) {
          dsInfo.sampleRows.forEach((row: any) => {
            if (!Array.isArray(row)) return;
            mappedColumns.forEach((col: any, idx: number) => {
              if (!col.sourceField) return; // Skip unmapped columns
              const val = row[idx] != null ? String(row[idx]).trim() : '';
              // Skip blanks, pure Excel date serials (5-digit numbers), and very long strings
              if (!val || val.length === 0 || val.length > 100 || /^\d{5,}$/.test(val)) return;
              autoFilters.push({
                id: `filt_${Date.now()}_${idx}_${val.substring(0, 5)}`,
                field: col.sourceField,
                operator: FilterOperator.EQUALS,
                value: val
              });
            });
          });
        }

        // Find the data-only name for this sheet from the skeleton
        let dataOnlyName = dsInfo.name;
        if (fbdiStructure) {
          try {
            const struct = typeof fbdiStructure === 'string' ? JSON.parse(fbdiStructure) : fbdiStructure;
            const dataOnlySheets = struct.vba?.dataOnlySheets || [];
            // Match by index or name
            const sheetIdx = dataSheetInfo.indexOf(dsInfo);
            if (dataOnlySheets[sheetIdx]) {
              dataOnlyName = dataOnlySheets[sheetIdx];
            }
          } catch (e) {
            console.warn("Failed to parse fbdiStructure for sheet naming:", e);
          }
        }

        const newSpec: FileSpecification = {
          id: specId,
          objectGroupId: groupId,
          name: dsInfo.name, // Original sheet name from Excel
          createdAt: new Date().toISOString(),
          version: 1.0,
          format: ExportFormat.FBDI,
          columns: mappedColumns,
          filters: autoFilters,
          templateData: wbBase64,
          sheetName: dataOnlyName, // Data-only name (will be saved to LOAD_FILE_NAME)
          backendTemplateName: backendTemplateName
        };
        newSpecs.push(newSpec);
      });

      if (newSpecs.length > 0) {
        // --- PHASE 4: Join Discovery & Architecture Consolidation ---
        // 1. Identify directly referenced tables from mapping
        const directlyReferenced = new Set<string>();
        newSpecs.forEach(spec => {
          spec.columns.forEach(col => {
            if (col.sourceField) {
              const [tableName] = col.sourceField.split('.');
              directlyReferenced.add(tableName.toUpperCase());
            }
          });
        });

        const initialUsedTables = Array.from(directlyReferenced);
        console.log(`[Join Discovery] Discovering connections (Direct & Indirect) for winners:`, initialUsedTables);

        // 2. Discover joins (including indirect paths via bridge tables)
        let discoveredRelationships: any[] = [];
        if (initialUsedTables.length > 1) {
          try {
            const relRes = await fetch(`http://localhost:3006/api/fbdi/discovery/resolve-relationships?tables=${initialUsedTables.join(',')}`);
            const relData = await relRes.json();
            if (relData && relData.success) {
              discoveredRelationships = relData.relationships;
              console.log(`[Join Discovery] Found ${discoveredRelationships.length} relationships (including bridges).`);
            }
          } catch (err) {
            console.error("Indirect join discovery failed", err);
          }
        }

        // 3. Identify ALL required tables (Referenced + Discovered Bridges)
        const allRequiredTables = new Set(directlyReferenced);
        discoveredRelationships.forEach(rel => {
          allRequiredTables.add(rel.sourceObjectId.toUpperCase());
          allRequiredTables.add(rel.targetObjectId.toUpperCase());
        });

        // 4. Hydrate metadata for any bridge tables missing from initial discovery
        const missingBridgeTables = Array.from(allRequiredTables).filter(t =>
          !dbObjects.some(obj => (obj.tableName || obj.name).toUpperCase() === t)
        );

        if (missingBridgeTables.length > 0) {
          console.log(`[Bridge Hydration] Fetching column metadata for ${missingBridgeTables.length} bridge tables:`, missingBridgeTables);
          try {
            const detailRes = await fetch(`http://localhost:3006/api/fbdi/discovery/table-details?tables=${missingBridgeTables.join(',')}`);
            const detailData = await detailRes.json();
            if (detailData && detailData.success) {
              dbObjects = [...dbObjects, ...detailData.objects];
              console.log(`[Bridge Hydration] Successfully hydrated ${detailData.objects.length} intermediate tables.`);
            }
          } catch (err) {
            console.error("Bridge table hydration failed", err);
          }
        }

        // 5. Final Pruning: Keep only those in allRequiredTables
        console.log(`[Architecture Pruning] Finalizing architecture with ${allRequiredTables.size} required tables.`);
        dbObjects = dbObjects.filter(obj => allRequiredTables.has((obj.tableName || obj.name).toUpperCase()));
        relationships = discoveredRelationships;


        setActiveSpec(null); // Show Source Architecture

        // 4. Persist Model & Architecture to Database
        console.log("Persisting model metadata to database...");
        try {
          const saveRes = await fetch('http://localhost:3006/api/fbdi/save-model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              modelName: moduleName,
              templateName: backendTemplateName || file.name,
              fbdiStructure: fbdiStructure,
              username: 'Guest', // Placeholder
              userId: '1001',    // Placeholder
              objects: dbObjects,
              relationships: relationships || [], // New: Store relationships in architecture
              specs: newSpecs
            })
          });
          const saveResult = await saveRes.json();
          if (saveResult.success) {
            console.log(`Model persisted successfully with ID: ${saveResult.modelId}`);
            const realGroupId = `grp_db_${saveResult.modelId}`;

            const newGroup: ObjectGroup = {
              id: realGroupId,
              modelId: saveResult.modelId,
              name: moduleName,
              databaseType: 'ORACLE',
              objects: dbObjects,
              relationships: relationships || []
            };

            const hydratedSpecs = newSpecs.map(s => ({ ...s, objectGroupId: realGroupId }));

            setGroups(prev => [...prev.filter(g => g.id !== groupId), newGroup]);
            setSpecifications(prev => [...prev.filter(s => s.objectGroupId !== groupId), ...hydratedSpecs]);
            setSelectedGroup(newGroup);

            // Access to saveResult is safe here
            const targetModelId = saveResult.modelId;
            const targetGroupId = groupId;
            const completionDelay = options.silent ? 100 : 1200;

            updateProgress('Template Mapping Complete!', 100, true);

            setTimeout(() => {
              if (!options.silent) {
                setFbdiLoading(false);
                setIsFbdiModalOpen(false);
                navigate(`/fbdi/models/${targetGroupId}`);
              }
            }, completionDelay);

            return { success: true, modelId: targetModelId, groupId: targetGroupId };
          } else {
            console.error("Failed to persist model:", saveResult.message);
            return { success: false, message: saveResult.message };
          }
        } catch (saveErr) {
          console.error("Error calling save-model API:", saveErr);
          return { success: false, message: "Save failed" };
        }

      } else {
        if (!options.silent) alert("No valid sheets/headers found in FBDI file.");
        setFbdiLoading(false);
        return { success: false, message: "No valid sheets found" };
      }

    } catch (err: any) {
      console.error(err);
      if (!options.silent) alert("Failed to parse FBDI file: " + err.message);
      setFbdiLoading(false);
      return { success: false, message: err.message };
    } finally {
      // fbdiLoading handles the state now
    }
  };

  const saveSpecification = async () => {
    if (!activeSpec) return;

    setSaveLoading(true);
    // Persist to Backend if model exists
    if (selectedGroup?.modelId) {

      console.log(`Saving extraction '${activeSpec.name}' (Version: ${activeSpec.version}) to backend...`);
      try {
        const res = await fetch('http://localhost:3006/api/fbdi/extraction/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelId: selectedGroup.modelId,
            extractionName: activeSpec.name,
            columns: activeSpec.columns,
            filters: activeSpec.filters,
            sqlQuery: '',
            templateName: activeSpec.backendTemplateName || 'N/A',
            version: activeSpec.version,
            sheetName: activeSpec.sheetName,
            isClone: false
          })
        });
        const result = await res.json();
        setSaveLoading(false);
        if (result.success) {
          console.log(`Extraction version ${result.version} saved successfully.`);
          alert(`Success: Specification version ${result.version} has been saved to the database.`);
        } else {
          console.error("Failed to save extraction:", result.message);
          alert("Failed to save: " + result.message);
        }
      } catch (err) {
        setSaveLoading(false);
        console.error("Error calling update extraction API:", err);
        alert("Error connecting to server while saving.");
      }
    } else {
      setSaveLoading(false);
      // Local only save for unsaved models
      alert("Local changes saved. To persist to database, please save the Model first.");
    }
  };


  const handleDownloadExcel = () => {
    if (!activeSpec || !selectedGroup) return;

    const mappingData = activeSpec.columns.map(col => ({
      'Target Label': col.targetName,
      'Source Field': col.sourceField,
      'Transformations': col.transformations.map(t => t.type).join(' -> ')
    }));

    const filterData = activeSpec.filters.map(f => ({
      'Filter Field': f.field,
      'Operator': f.operator,
      'Comparison Value': f.value
    }));

    const metadataData = [
      { 'Attribute': 'Specification Name', 'Value': activeSpec.name },
      { 'Attribute': 'Version', 'Value': Number(activeSpec.version).toFixed(1) },
      { 'Attribute': 'Data Model Context', 'Value': selectedGroup.name },
      { 'Attribute': 'DB Dialect', 'Value': selectedGroup.databaseType },
      { 'Attribute': 'Export Format', 'Value': activeSpec.format.toUpperCase() },
      { 'Attribute': 'Created At', 'Value': activeSpec.createdAt }
    ];

    const wb = XLSX.utils.book_new();
    const mappingSheet = XLSX.utils.json_to_sheet(mappingData);
    XLSX.utils.book_append_sheet(wb, mappingSheet, "Mapping Definitions");
    const filterSheet = XLSX.utils.json_to_sheet(filterData);
    XLSX.utils.book_append_sheet(wb, filterSheet, "Extraction Filters");
    const metaSheet = XLSX.utils.json_to_sheet(metadataData);
    XLSX.utils.book_append_sheet(wb, metaSheet, "Metadata");

    XLSX.writeFile(wb, `${activeSpec.name.replace(/\s+/g, '_')}_v${Number(activeSpec.version).toFixed(1)}.xlsx`);
  };

  const handleOpenPreview = async () => {
    if (!activeSpec || !selectedGroup) return;

    // Validation: Check for mandatory columns (starting with *) that are not mapped
    const missingMandatory = activeSpec.columns.filter(col =>
      col.targetName.trim().endsWith('*') && (!col.sourceField || col.sourceField.trim() === '')
    );

    if (missingMandatory.length > 0) {
      const names = missingMandatory.map(c => c.targetName).join('\n');
      alert(`Validation Error: The following mandatory columns are not mapped:\n\n${names}\n\nPlease map these fields to proceed.`);
      return;
    }

    // Warning: Unmapped non-mandatory columns
    const unmappedNonMandatory = activeSpec.columns.filter(col =>
      !col.targetName.trim().endsWith('*') && (!col.sourceField || col.sourceField.trim() === '')
    );

    if (unmappedNonMandatory.length > 0) {
      const confirmed = confirm(`Warning: ${unmappedNonMandatory.length} columns are not mapped and will be exported as NULL values.\n\nDo you want to proceed with the extraction?`);
      if (!confirmed) return;
    }

    navigate('/fbdi/data-preview'); // Open preview modal via route
    setIsPreviewLoading(true);
    setPreviewData([]);
    setPreviewSql('');

    try {
      const columnsPayload = activeSpec.columns.map(col => {
        // Handle Unmapped Columns -> NULL
        if (!col.sourceField || col.sourceField.trim() === '') {
          return {
            alias: col.targetName,
            expression: 'NULL',
            table: null,
            column: null,
            transformations: []
          };
        }

        const [objName, fieldName] = col.sourceField.split('.');
        const obj = selectedGroup.objects.find(o => o.name === objName);
        return {
          table: obj ? obj.tableName : objName,
          column: fieldName,
          alias: col.targetName,
          transformations: col.transformations
        };
      });

      const tables = [...new Set(columnsPayload.filter(c => c !== null).map(c => c!.table))].filter(Boolean);
      const joinsPayload: any[] = [];

      if (tables.length > 1 && selectedGroup.relationships) {
        const idToTable = new Map(selectedGroup.objects.map(o => [o.id, o.tableName]));
        selectedGroup.relationships.forEach(rel => {
          const sourceTable = idToTable.get(rel.sourceObjectId);
          const targetTable = idToTable.get(rel.targetObjectId);
          if (sourceTable && targetTable && tables.includes(sourceTable) && tables.includes(targetTable)) {
            joinsPayload.push({
              leftTable: sourceTable,
              rightTable: targetTable,
              condition: rel.condition,
              type: rel.joinType
            });
          }
        });
      }

      // Map filters physical table names
      const filtersPayload = (activeSpec.filters || []).map(f => {
        const [objQuery, colName] = f.field.split('.');
        const obj = selectedGroup.objects.find(o =>
          (o.tableName || '').toUpperCase() === objQuery.toUpperCase() ||
          (o.name || '').toUpperCase() === objQuery.toUpperCase()
        );
        const physicalTable = obj ? obj.tableName : objQuery;
        return {
          ...f,
          field: `${physicalTable}.${colName}`
        };
      });

      const response = await fetch('http://localhost:3006/api/fbdi/generate-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: columnsPayload,
          joins: joinsPayload,
          filters: filtersPayload,
          limit: 100
        })
      });
      const result = await response.json();

      if (result.success) {
        setPreviewSql(result.query);
        try {
          // Fetch real sample data from the DB using the generated SQL
          const dataResponse = await fetch('http://localhost:3006/api/fbdi/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              columns: columnsPayload,
              joins: joinsPayload,
              filters: filtersPayload,
              limit: 5 // Get only 5 rows for preview
            })
          });
          const dataResult = await dataResponse.json();
          if (dataResult.success) {
            setPreviewData(dataResult.data || []);
          } else {
            console.warn("Failed to fetch real preview data", dataResult.message);
            setPreviewData([]);
          }
        } catch (fetchErr) {
          console.warn("Error fetching real preview data", fetchErr);
          setPreviewData([]);
        }
      } else {
        setPreviewSql('Error generating query: ' + result.message);
        alert('Query Generation Failed: ' + result.message);
      }
    } catch (e: any) {
      console.error("Preview failed", e);
      alert("Error: " + e.message);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleRunExtraction = async (
    targetSpec?: FileSpecification, 
    formatOverride?: ExportFormat, 
    options?: { silent?: boolean; onProgress?: (msg: string) => void; onComplete?: (filename: string) => void }
  ) => {
    const spec = targetSpec || activeSpec;
    if (!spec || !selectedGroup) return;

    const format = formatOverride || spec.format;

    // Validation: Check for mandatory columns (starting with *) that are not mapped
    const missingMandatory = spec.columns.filter(col =>
      col.targetName.trim().endsWith('*') && (!col.sourceField || col.sourceField.trim() === '')
    );

    if (missingMandatory.length > 0) {
      const names = missingMandatory.map(c => c.targetName).join('\n');
      alert(`Validation Error: The following mandatory columns are not mapped in '${spec.name}':\n\n${names}\n\nPlease map these fields to proceed.`);
      return;
    }

    // Warning: Unmapped non-mandatory columns (only if single spec run)
    if (!targetSpec) {
      const isCompletelyUnmapped = spec.columns.every(col => !col.sourceField || col.sourceField.trim() === '');

      if (isCompletelyUnmapped) {
        const confirmed = confirm(`Warning: The sheet '${spec.name}' has NO mapped columns. \n\nThis likely means the sheet identifier wasn't found in the metadata mapping table. The extraction will return an EMPTY file with only headers.\n\nDo you want to proceed anyway?`);
        if (!confirmed) return;
      } else {
        const unmappedNonMandatory = spec.columns.filter(col =>
          !col.targetName.trim().endsWith('*') && (!col.sourceField || col.sourceField.trim() === '')
        );

        if (unmappedNonMandatory.length > 0) {
          const confirmed = confirm(`Warning: ${unmappedNonMandatory.length} columns in '${spec.name}' are not mapped and will be exported as NULL values.\n\nDo you want to proceed?`);
          if (!confirmed) return;
        }
      }
    }

    const updateProgress = (msg: string, progress: number) => {
      if (options?.onProgress) options.onProgress(msg);
      if (!options?.silent) {
        setExportLoading(true);
        setExtractProgress(progress);
        setExtractStatus(msg);
      }
    };

    if (!options?.silent) {
      navigate('/fbdi/extraction-progress'); // Open progress modal via route
    }
    
    updateProgress('Initializing extraction engine...', 0);

    try {
      // Step 1: Initialization
      await new Promise(r => setTimeout(r, 400));
      updateProgress('Validating data model and security tokens...', 15);

      // Step 2: Model Validation & Mapping
      await new Promise(r => setTimeout(r, 500));
      updateProgress('Building optimized Oracle SQL queries (ATP)...', 35);

      const columnsPayload = spec.columns.map(col => {
        if (!col.sourceField || col.sourceField.trim() === '') {
          return { alias: col.targetName, expression: 'NULL', table: null, column: null, transformations: [] };
        }
        const [objName, fieldName] = col.sourceField.split('.');
        const obj = selectedGroup.objects.find(o => o.name === objName);
        return {
          table: obj ? obj.tableName : objName,
          column: fieldName,
          alias: col.targetName,
          transformations: col.transformations
        };
      });

      const tables = [...new Set(columnsPayload.filter(c => c !== null).map(c => c!.table))].filter(Boolean);
      const joinsPayload: any[] = [];
      if (tables.length > 1 && selectedGroup.relationships) {
        const idToTable = new Map(selectedGroup.objects.map(o => [o.id, o.tableName]));
        selectedGroup.relationships.forEach(rel => {
          const sourceTable = idToTable.get(rel.sourceObjectId);
          const targetTable = idToTable.get(rel.targetObjectId);
          if (sourceTable && targetTable && tables.includes(sourceTable) && tables.includes(targetTable)) {
            joinsPayload.push({ leftTable: sourceTable, rightTable: targetTable, condition: rel.condition, type: rel.joinType });
          }
        });
      }

      const filtersPayload = (spec.filters || []).map(f => {
        const [objQuery, colName] = f.field.split('.');
        const obj = selectedGroup.objects.find(o =>
          (o.tableName || '').toUpperCase() === objQuery.toUpperCase() ||
          (o.name || '').toUpperCase() === objQuery.toUpperCase()
        );
        const physicalTable = obj ? obj.tableName : objQuery;
        return { ...f, field: `${physicalTable}.${colName}` };
      });

      // Step 3: Database Query (The long pole)
      updateProgress('Executing data fetch on Oracle Database...', 50);

      const response = await fetch('http://localhost:3006/api/fbdi/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: columnsPayload,
          joins: joinsPayload,
          filters: filtersPayload,
          templateFile: spec.backendTemplateName,
          sheetName: spec.sheetName,
          exportFormat: format,
          specs: [spec],
          modelName: selectedGroup.name
        })
      });

      updateProgress('Processing database response and mapping schemas...', 75);

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = 'Extraction failed';
        try {
          const errJson = JSON.parse(text);
          errorMsg = errJson.message || errorMsg;
        } catch {
          errorMsg = `Server error (${response.status})`;
        }
        throw new Error(errorMsg);
      }

      // Step 4: Formatting
      setExtractProgress(85);
      setExtractProgress(85);
      setExtractStatus((format === ExportFormat.FBDI || format === ExportFormat.XLSM || format === ExportFormat.FBDI_XLSM || format === ExportFormat.FBDI_ZIP) ? 'Generating FBDI Package...' : 'Formatting data for Excel/CSV...');

      if (format === ExportFormat.FBDI || format === ExportFormat.XLSM || format === ExportFormat.FBDI_XLSM || format === ExportFormat.FBDI_ZIP) {
        const blob = await response.blob();
        setExtractProgress(95);
        setExtractStatus('Finalizing extraction package...');
        await new Promise(r => setTimeout(r, 300));

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        let extension = (format === ExportFormat.FBDI_ZIP || format === ExportFormat.FBDI) ? 'zip' : 'xlsm';

        // For FBDI, the filename should be the data-only sheet name (LOAD_FILE_NAME)
        const fileName = `${(spec.sheetName || spec.name).replace(/\s+/g, '_')}.${extension}`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        setExtractProgress(100);
        setExtractStatus('Success! Package ready.');
        await new Promise(r => setTimeout(r, 1000));
        navigate(selectedGroup && spec ? `/fbdi/models/${selectedGroup.id}/extractions/${spec.id}` : '/fbdi');
        return;
      }

      const result = await response.json();
      if (result.success) {
        setExtractProgress(95);
        setExtractStatus('Preparing download file...');

        if (format === ExportFormat.CSV) {
          const worksheet = XLSX.utils.json_to_sheet(result.data);
          const csv = XLSX.utils.sheet_to_csv(worksheet);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement("a");
          const url = URL.createObjectURL(blob);
          link.setAttribute("href", url);
          const fileName = `${(spec.sheetName || spec.name).replace(/\s+/g, '_')}.csv`;
          link.setAttribute("download", fileName);
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } else if (format === ExportFormat.REST) {
          // Show JSON in a pretty way or just alert
          setPreviewData(result.data);
          setPreviewSql(result.query || '');
          setIsPreviewOpen(true);
          navigate('/fbdi/data-preview');
        } else {
          alert(`${format.toUpperCase()} export complete.`);
        }

        updateProgress('Extraction Successful!', 100);
        
        if (options?.onComplete) options.onComplete(fileName);

        await new Promise(r => setTimeout(r, 1000));
        
        if (!options?.silent) {
          navigate(selectedGroup && spec ? `/fbdi/models/${selectedGroup.id}/extractions/${spec.id}` : '/fbdi');
        }
      } else {
        throw new Error(result.message || 'Unknown error');
      }
    } catch (e: any) {
      console.error("Extraction failed", e);
      alert("Error: " + e.message);
    } finally {
      setExportLoading(false);
      // setIsExtractingMode(false); // Handled by route change
    }
  };

  const handleBatchExtraction = async (
    format: ExportFormat,
    options?: { silent?: boolean; onProgress?: (msg: string) => void; onComplete?: (filename: string) => void }
  ) => {
    if (!selectedGroup) return;

    const isConfirmed = confirm("Please validate all the individual extractions and their data preview! \n\nIf validated ignore this message and confirm.");
    if (!isConfirmed) return;

    let groupSpecs = specifications.filter(s => s.objectGroupId === selectedGroup.id);

    // Ignore Instructions sheets natively in Batch Export
    groupSpecs = groupSpecs.filter(s => !(s.sheetName || '').toLowerCase().includes('instruction'));
    if (groupSpecs.length === 0) return;

    // Check for completely unmapped sheets in batch
    const unmappedSheets = groupSpecs.filter(spec =>
      spec.columns.every(col => !col.sourceField || col.sourceField.trim() === '')
    );

    if (unmappedSheets.length > 0) {
      const sheetNames = unmappedSheets.map(s => s.name).join(', ');
      const confirmed = confirm(`Warning: The following sheets have NO mapped columns:\n\n${sheetNames}\n\nThese sheets are likely missing from the metadata mapping table and will be extracted as EMPTY sheets. \n\nDo you want to proceed with the batch extraction anyway?`);
      if (!confirmed) return;
    }

    const updateProgress = (msg: string, progress: number) => {
      if (options?.onProgress) options.onProgress(msg);
      if (!options?.silent) {
        setExportLoading(true);
        setExtractProgress(progress);
        setExtractStatus(msg);
      }
    };

    if (!options?.silent) {
      navigate('/fbdi/extraction-progress');
    }
    
    updateProgress(`Preparing batch extraction for ${groupSpecs.length} sheets...`, 0);

    try {
      // Step 1: Initialization & Validation
      await new Promise(r => setTimeout(r, 400));
      updateProgress('Building optimized parallel extraction pipelines...', 15);
      // Prepare specs for backend
      const specsPayload = groupSpecs.map(spec => {
        const columns = spec.columns.map(col => {
          if (!col.sourceField || col.sourceField.trim() === '') {
            return { alias: col.targetName, expression: 'NULL', table: null, column: null, transformations: [] };
          }
          const [objQuery, fieldName] = col.sourceField.split('.');
          const obj = selectedGroup.objects.find(o =>
            (o.tableName || '').toUpperCase() === objQuery.toUpperCase() ||
            (o.name || '').toUpperCase() === objQuery.toUpperCase()
          );
          return {
            table: obj ? obj.tableName : objQuery,
            column: fieldName,
            alias: col.targetName,
            transformations: col.transformations
          };
        });

        const tables = [...new Set(columns.filter(c => c !== null).map(c => c!.table))].filter(Boolean);
        const joins: any[] = [];
        if (tables.length > 1 && selectedGroup.relationships) {
          const idToTable = new Map(selectedGroup.objects.map(o => [o.id, o.tableName]));
          selectedGroup.relationships.forEach(rel => {
            const sourceTable = idToTable.get(rel.sourceObjectId);
            const targetTable = idToTable.get(rel.targetObjectId);
            if (sourceTable && targetTable && tables.includes(sourceTable) && tables.includes(targetTable)) {
              joins.push({ leftTable: sourceTable, rightTable: targetTable, condition: rel.condition, type: rel.joinType });
            }
          });
        }

        // Map filters physical table names
        const filtersPayload = (spec.filters || []).map(f => {
          const [objQuery, colName] = f.field.split('.');
          const obj = selectedGroup.objects.find(o =>
            (o.tableName || '').toUpperCase() === objQuery.toUpperCase() ||
            (o.name || '').toUpperCase() === objQuery.toUpperCase()
          );
          const physicalTable = obj ? obj.tableName : objQuery;
          return {
            ...f,
            field: `${physicalTable}.${colName}`
          };
        });

        return {
          sheetName: spec.sheetName || spec.name.replace('FBDI - ', '').trim(),
          columns,
          joins,
          filters: filtersPayload,
          id: spec.id,
          objectGroupId: spec.objectGroupId
        };
      });

      // Step 2: Parallel SQL Construction
      await new Promise(r => setTimeout(r, 600));
      updateProgress(`Connecting to Oracle ATP - Executing ${specsPayload.length} extracts in parallel...`, 35);

      const response = await fetch('http://localhost:3006/api/fbdi/extract-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specs: specsPayload,
          exportFormat: format,
          templateFile: groupSpecs[0]?.backendTemplateName,
          modelName: selectedGroup.name
        })
      });

      updateProgress('Merging results and generating unified FBDI ZIP...', 65);

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = 'Batch extraction failed';
        try {
          const errJson = JSON.parse(text);
          errorMsg = errJson.message || errorMsg;
        } catch {
          errorMsg = `Server error (${response.status})`;
        }
        throw new Error(errorMsg);
      }

      if (format === ExportFormat.FBDI || format === ExportFormat.XLSM || format === ExportFormat.FBDI_XLSM || format === ExportFormat.FBDI_ZIP) {
        const contentType = response.headers.get('Content-Type');
        if (contentType && contentType.includes('application/json')) {
          const result = await response.json();
          throw new Error(result.message || "Server returned JSON instead of Excel file");
        }

        const blob = await response.blob();
        if (blob.size < 100) {
          const text = await blob.text();
          if (text.startsWith('{')) {
            const errJson = JSON.parse(text);
            throw new Error(errJson.message || "Invalid file content received");
          }
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const extension = format === ExportFormat.FBDI_ZIP ? 'zip' : 'xlsm';

        // Extract filename from Content-Disposition header if available
        const contentDisposition = response.headers.get('Content-Disposition');
        let fileName = `${selectedGroup.name.replace(/\s+/g, '_')}_Consolidated_FBDI.${extension}`;
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="(.+)"/);
          if (match) fileName = match[1];
        }

        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        updateProgress('Batch Extraction Successful!', 100);

        if (options?.onComplete) options.onComplete(fileName);

        await new Promise(r => setTimeout(r, 1000));
        
        if (!options?.silent) {
          navigate(selectedGroup ? `/fbdi/models/${selectedGroup.id}` : '/fbdi');
        }
        return;
      }

      const result = await response.json();
      if (result.success) {
        updateProgress('Success! Batch download ready.', 100);

        if (options?.onComplete) options.onComplete('BatchExport.zip');

        await new Promise(r => setTimeout(r, 1000));
        
        if (!options?.silent) {
          navigate(selectedGroup ? `/fbdi/models/${selectedGroup.id}` : '/fbdi');
        }
      } else {
        throw new Error(result.message || 'Unknown error');
      }
    } catch (err: any) {
      console.error("Batch extraction failed", err);
      alert("Error: " + err.message);
    } finally {
      setExportLoading(false);
      // setIsExtractingMode(false); // Handled by route change
    }
  };

  const updateColumn = (id: string, updates: Partial<ColumnDefinition>) => {
    if (!activeSpec) return;
    const newSpec = {
      ...activeSpec,
      columns: activeSpec.columns.map(c => c.id === id ? { ...c, ...updates } : c)
    };
    setActiveSpec(newSpec);
    setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
  };

  const addColumn = () => {
    if (!activeSpec || !selectedGroup || !selectedGroup.objects || selectedGroup.objects.length === 0) return;
    const defaultObj = selectedGroup.objects[0];
    const defaultField = defaultObj.fields?.[0]?.name || 'ID';
    const newSpec = {
      ...activeSpec,
      columns: [...activeSpec.columns, {
        id: `col_${Date.now()}`,
        sourceField: `${defaultObj.tableName}.${defaultField}`,
        targetName: 'EXTRACT_FIELD',
        transformations: [],
        confidenceScore: 0,
        reasoning: 'Manually Added'
      } as ColumnDefinition]
    };
    setActiveSpec(newSpec);
    setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
  };

  const removeColumn = (id: string) => {
    if (!activeSpec) return;
    const newSpec = { ...activeSpec, columns: activeSpec.columns.filter(c => c.id !== id) };
    setActiveSpec(newSpec);
    setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
  };

  const addFilter = () => {
    if (!activeSpec || !selectedGroup || !selectedGroup.objects || selectedGroup.objects.length === 0) return;
    const defaultObj = selectedGroup.objects[0];
    const defaultField = defaultObj.fields?.[0]?.name || 'ID';
    const newSpec = {
      ...activeSpec,
      filters: [...(activeSpec.filters || []), {
        id: `filter_${Date.now()}`,
        field: `${defaultObj.tableName}.${defaultField}`,
        operator: FilterOperator.EQUALS,
        value: ''
      }]
    };
    setActiveSpec(newSpec);
    setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
  };

  const updateFilter = (id: string, updates: Partial<FilterCondition>) => {
    if (!activeSpec) return;
    const newSpec = {
      ...activeSpec,
      filters: (activeSpec.filters || []).map(f => f.id === id ? { ...f, ...updates } : f)
    };
    setActiveSpec(newSpec);
    setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
  };

  const removeFilter = (id: string) => {
    if (!activeSpec) return;
    const newSpec = { ...activeSpec, filters: (activeSpec.filters || []).filter(f => f.id !== id) };
    setActiveSpec(newSpec);
    setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
  };

  const handleApplySqlFromPreview = async (sql: string) => {
    try {
      const response = await fetch('http://localhost:3006/api/fbdi/sql-to-json-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
      });
      const result = await response.json();
      if (result.success && result.mappings) {
        handleApplySqlMapping(result.mappings);
      } else {
        alert("SQL Mapping Analysis failed: " + (result.message || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error analyzing SQL: " + err.message);
    }
  };

  const handleApplySqlMapping = (mappings: any[]) => {
    if (!activeSpec || !selectedGroup) return;

    let matchCount = 0;
    const updatedColumns = [...activeSpec.columns];

    mappings.forEach(m => {
      const targetAlias = m.DATA_IDENTIFIER;
      const targetColIndex = updatedColumns.findIndex(c => c.targetName.toUpperCase() === targetAlias.toUpperCase());

      // Look up table in Group Objects to get the technical tableName
      const matchedObj = selectedGroup.objects.find(o =>
        (o.tableName || '').toUpperCase() === (m.TABLE_NAME || '').toUpperCase() ||
        (o.name || '').toUpperCase() === (m.TABLE_NAME || '').toUpperCase()
      );
      const parsedSource = matchedObj ? `${matchedObj.tableName}.${m.COLUMN_NAME}` : `${m.TABLE_NAME}.${m.COLUMN_NAME}`;

      if (targetColIndex > -1) {
        updatedColumns[targetColIndex] = {
          ...updatedColumns[targetColIndex],
          sourceField: parsedSource,
          reasoning: 'Updated from Manual SQL'
        };
        matchCount++;
      }
    });

    if (matchCount > 0) {
      const newSpec = { ...activeSpec, columns: updatedColumns };
      setActiveSpec(newSpec);
      setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));

      if (isPreviewOpen) {
        navigate(-1);
      }

      console.log(`Success: Mapped ${matchCount} columns from SQL query!`);
    } else {
      alert("No valid mappings found in the SQL analysis.");
    }
  };

  const updateSpecName = (name: string) => {
    if (!activeSpec) return;
    const newSpec = { ...activeSpec, name };
    setActiveSpec(newSpec);
    setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
  };

  const [assistantMode, setAssistantMode] = useState<'hidden' | 'overlay' | 'full'>('hidden');

  return (
    <div className="t-PageBody--fusion flex h-screen overflow-hidden bg-slate-50 text-slate-900">
      {/* GLOBAL SIDEBAR (Hided on Home and Import Page) */}
      {!['/', '/fbdi/fbdi-import'].includes(location.pathname) && (
        <Sidebar
          groups={groups}
          selectedGroupId={selectedGroup?.id || null}
          activeSpecId={activeSpec?.id || null}
          onGroupSelect={(id) => {
            navigate(`/fbdi/models/${id}`);
          }}
          onCreateSpec={handleCreateNewSpec}
          onToggleAssistant={() => setAssistantMode(prev => prev === 'full' ? 'full' : 'overlay')}
        />
      )}

      <main className="flex-1 flex flex-col overflow-hidden bg-[#fafafa]">
        {/* REFINED HEADER (Removed nav items, kept AI bar) */}
        {!['/', '/fbdi/fbdi-import'].includes(location.pathname) && (
          <header className="fusion-header h-[70px] flex items-center px-8 gap-6 shadow-md z-10">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="E.g., 'Generate an extract for active suppliers with their tax rates...'"
                className="w-full py-2.5 pl-12 pr-4 text-sm rounded-lg border-none shadow-inner"
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAiGeneration()}
              />
              <div className="absolute left-4 top-3 text-slate-400">
                <Icons.Brain className="w-5 h-5" />
              </div>
              {isAiLoading && (
                <div className="absolute right-4 top-3 flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></div>
                  <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">AI Mapping...</span>
                </div>
              )}
            </div>

            {/* <div className="flex items-center gap-3">
               <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 py-1 border border-slate-200 rounded-full bg-slate-50">Enterprise Edition</div>
            </div> */}
          </header>
        )}
        <div className={`flex-1 overflow-y-auto custom-scrollbar ${location.pathname.startsWith('/fbdi') && location.pathname !== '/fbdi/fbdi-import' ? 'p-6' : ''}`}>
          <div className={`mx-auto space-y-6 ${(location.pathname === '/' || location.pathname === '/fbdi/fbdi-import' ? 'max-w-full' : 'max-w-6xl')}`}>
            {location.pathname === '/' && (
              <Home />
            )}
            {location.pathname === '/fbdi/fbdi-import' && (
              <FBDIImportModal
                isOpen={true}
                onClose={() => navigate('/fbdi')}
                onImport={async (file, mod) => { await handleFbdiSubmit(file, mod); }}
                isLoading={isAiLoading}
              />
            )}
            {(location.pathname === '/fbdi' || location.pathname === '/dashboard') && (
              <DashboardView
                groups={groups}
                specifications={specifications}
                onModelSelect={(id) => navigate(`/fbdi/models/${id}`)}
                onNewImport={handleFbdiImport}
              />
            )}
            {location.pathname === '/fbdi/load-to-oracle' && (
              <LoadToInterface />
            )}
            {location.pathname === '/fbdi/database-config' && (
              <DatabaseConfigPage />
            )}
            {location.pathname === '/fbdi/env-config' && (
              <FusionConfigPage />
            )}

            {/* {!activeSpec && selectedGroup && location.pathname !== '/fbdi/assistant' && (
              <div className="mb-6">
                <button
                  onClick={() => navigate('/fbdi')}
                  className="t-Button t-Button--icon t-Button--noLabel bg-white border-slate-200 shadow-sm"
                  title="Back to Dashboard"
                >
                  <Icons.Play className="w-4 h-4 rotate-180" />
                </button>
              </div>
            )} */}
            {!activeSpec && selectedGroup && !['/fbdi/assistant', '/fbdi/load-to-oracle'].includes(location.pathname) && (
              <DataModelView
                group={selectedGroup}
                specifications={specifications.filter(s => s.objectGroupId === selectedGroup.id)}
                onUpdateGroup={handleUpdateGroup}
                onSaveArchitecture={handleSaveArchitecture}
                onSelectSpec={(spec) => navigate(`/fbdi/models/${selectedGroup.id}/extractions/${spec.id}`)}
                onCreateSpec={() => handleCreateNewSpec(selectedGroup.id)}
                onDeleteSpec={handleDeleteSpec}
                onRunExtraction={(format) => {
                  console.log(`Running batch extraction in ${format} format for group ${selectedGroup.id}`);
                  handleBatchExtraction(format);
                }}
              />
            )}

            {activeSpec && location.pathname !== '/fbdi/load-to-oracle' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center justify-between">
                  <div className="flex items-center gap-6">
                    <button
                      onClick={() => navigate(`/fbdi/models/${selectedGroup!.id}`)}
                      className="t-Button t-Button--icon t-Button--noLabel"
                      title="Back to Model Architecture"
                    >
                      <Icons.Play className="w-4 h-4 rotate-180" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 min-w-0 flex-1">

                        <input
                          className="text-xl font-bold text-slate-800 tracking-tight bg-transparent border-none outline-none focus:ring-1 focus:ring-[#1e709a]/10 rounded px-1 w-full min-w-[500px]"
                          value={activeSpec.name}
                          onChange={(e) => updateSpecName(e.target.value)}
                        />

                        <span className="text-[10px] bg-[#e5f1f8] text-[#1e709a] px-3 py-1 rounded-md font-black uppercase tracking-widest border border-[#1e709a]/10">v{Number(activeSpec.version).toFixed(1)}</span>
                      </div>
                      <p className="text-slate-500 text-xs mt-1 font-medium">Model Context: <span className="text-[#1e709a] font-bold">{selectedGroup?.name}</span> <span className="mx-2">•</span> Dialect: <span className={`${selectedGroup?.databaseType === 'ORACLE' ? 'text-orange-600' : 'text-[#1e709a]'} font-bold`}>{selectedGroup?.databaseType}</span></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1 ml-1">Export Target</label>
                      <select
                        className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-purple-500 outline-none"
                        value={activeSpec.format}
                        onChange={(e) => {
                          const newSpec = { ...activeSpec, format: e.target.value as ExportFormat };
                          setActiveSpec(newSpec);
                          setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
                        }}
                      >
                        <option value={ExportFormat.CSV}>CSV</option>
                        <option value={ExportFormat.XLS}>EXCEL</option>
                        <option value={ExportFormat.XLSM}>FBDI - XLSM</option>
                        <option value={ExportFormat.PIPE}>PIPE</option>
                      </select>
                    </div>
                    <div className="flex gap-2 items-end">
                      <button onClick={handleCloneSpec} className="t-Button t-Button--icon t-Button--noLabel" title="Save as New Version (Clone)">
                        <Icons.Copy className="w-5 h-5" />
                      </button>
                      <button onClick={handleDownloadExcel} className="t-Button t-Button--icon t-Button--noLabel" title="Download Specification (Excel)">
                        <Icons.Download className="w-5 h-5" />
                      </button>
                      <button onClick={() => setIsManualSqlModalOpen(true)} className="t-Button t-Button--simple flex items-center gap-2">
                        <Icons.Code className="w-4 h-4" /> Manual SQL Query
                      </button>
                      <button onClick={handleOpenPreview} className="t-Button t-Button--simple flex items-center gap-2">
                        <Icons.Brain className="w-4 h-4" /> Data Preview & SQL Query
                      </button>
                      <button onClick={saveSpecification} className="t-Button t-Button--simple flex items-center gap-2">
                        <Icons.File className="w-4 h-4" /> Save Specification
                      </button>
                      <div className="relative">
                        <button
                          onClick={() => setIsExtractDropdownOpen(!isExtractDropdownOpen)}
                          disabled={exportLoading}
                          className="t-Button t-Button--simple bg-[#1e709a] text-white flex items-center gap-2 disabled:opacity-50 pr-8"
                        >
                          {exportLoading ? 'Processing...' : 'Run Extraction'}
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            <svg className={`w-3 h-3 transition-transform ${isExtractDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>

                        {isExtractDropdownOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-[90]"
                              onClick={() => setIsExtractDropdownOpen(false)}
                            ></div>
                            <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.1)] z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                              <div className="p-2 border-b border-slate-100 bg-slate-50/50">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-2">Select Export Format</span>
                              </div>
                              <button
                                onClick={() => {
                                  setIsExtractDropdownOpen(false);
                                  handleRunExtraction(undefined, ExportFormat.FBDI);
                                }}
                                className="w-full text-left px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors group"
                              >
                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                                  <Icons.File className="w-4 h-4 text-blue-600" />
                                </div>
                                <div>
                                  <span className="block">FBDI Format</span>
                                  <span className="text-[10px] text-slate-400 font-medium">Metadata-aware CSV</span>
                                </div>
                              </button>
                              <button
                                onClick={() => {
                                  setIsExtractDropdownOpen(false);
                                  handleRunExtraction(undefined, ExportFormat.REST);
                                }}
                                className="w-full text-left px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors group"
                              >
                                <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center group-hover:bg-purple-100 transition-colors">
                                  <Icons.Code className="w-4 h-4 text-purple-600" />
                                </div>
                                <div>
                                  <span className="block">REST API</span>
                                  <span className="text-[10px] text-slate-400 font-medium">Raw JSON Response</span>
                                </div>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Filters Section  */}
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#e5f1f8] flex items-center justify-center text-[#1e709a] border border-[#1e709a]/10">
                        <Icons.Settings className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-[#212121] uppercase tracking-widest">Data Filters</h3>
                        <p className="text-[10px] text-slate-500 font-bold">Restrict output based on specific criteria</p>
                      </div>
                    </div>
                    <button
                      onClick={addFilter}
                      className="text-[10px] bg-[#e5f1f8] hover:bg-[#1e709a] hover:text-white text-[#1e709a] px-3 py-1.5 rounded-md font-bold uppercase tracking-wide transition-all border border-[#1e709a]/10"
                    >
                      + Add Filter
                    </button>
                  </div>

                  <div className="space-y-3 pb-12">
                    {(activeSpec.filters || []).length === 0 && (
                      <div className="py-4 border border-dashed border-slate-200 rounded-xl text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        No active filters. Extracting full dataset.
                      </div>
                    )}
                    {(activeSpec.filters || []).map(filter => (
                      <div key={filter.id} className="flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-200">
                        <div className="flex-1">
                          <SearchableSelect
                            placeholder="Select Filter Field..."
                            className="w-full"
                            value={filter.field}
                            onChange={(val) => updateFilter(filter.id, { field: val })}
                            options={selectedGroup?.objects?.flatMap(obj =>
                              (obj.fields || []).map(f => ({
                                label: `${obj.tableName}.${f.name}`,
                                value: `${obj.tableName}.${f.name}`,
                                group: obj.name,
                                type: f.type
                              }))
                            ) || []}
                          />
                        </div>
                        <div className="w-32">
                          <select
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-xs font-bold text-[#1e709a] outline-none focus:ring-1 focus:ring-[#1e709a]/30 transition-all"
                            value={filter.operator}
                            onChange={(e) => updateFilter(filter.id, { operator: e.target.value as FilterOperator })}
                          >
                            {Object.values(FilterOperator).map(op => (
                              <option key={op} value={op}>{op}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1">
                          <input
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-xs font-medium text-slate-800 outline-none focus:ring-1 focus:ring-[#1e709a]/30 transition-all"
                            placeholder="Enter value..."
                            value={filter.value}
                            onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                          />
                        </div>
                        <button onClick={() => removeFilter(filter.id)} className="p-2 text-slate-300 hover:text-red-500 transition-all hover:bg-red-50 rounded-md">
                          <Icons.Plus className="w-5 h-5 rotate-45" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6 pb-40">
                  <div className="flex items-center gap-3 px-2">
                    <div className="w-8 h-8 rounded-lg bg-[#e5f1f8] flex items-center justify-center text-[#1e709a] border border-[#1e709a]/10">
                      <Icons.File className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-[#212121] uppercase tracking-widest">Column Mapping</h3>
                      <p className="text-[10px] text-slate-500 font-bold">Define the structure and content of your extract</p>
                    </div>
                  </div>
                  {activeSpec.columns.length === 0 && (
                    <div className="py-20 bg-white border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400">
                      <Icons.File className="w-12 h-12 mb-4 opacity-10" />
                      <p className="font-bold text-sm">No extraction fields defined.</p>
                    </div>
                  )}
                  {activeSpec.columns.map((col) => (
                    <div key={col.id} className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 relative group/card hover:shadow-md transition-all">
                      <div className="absolute top-0 left-0 w-1.5 h-full bg-[#cbd5e1]"></div>


                      <div className="flex justify-between items-start mb-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-widest">Output Label (Header)</label>
                            <input
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-[#1e709a]/10 focus:border-[#1e709a]/30 outline-none transition-all"
                              placeholder="E.g., CUSTOMER_EMAIL"
                              value={col.targetName}
                              onChange={(e) => updateColumn(col.id, { targetName: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-widest">Source Mapping</label>
                            <SearchableSelect
                              className="w-full"
                              value={col.sourceField}
                              onChange={(val) => updateColumn(col.id, { sourceField: val })}
                              options={selectedGroup?.objects?.flatMap(obj =>
                                (obj.fields || []).map(f => ({
                                  label: `${obj.tableName}.${f.name}`,
                                  value: `${obj.tableName}.${f.name}`,
                                  group: obj.name,
                                  type: f.type
                                }))
                              ) || []}
                            />
                          </div>
                        </div>
                        <button onClick={() => removeColumn(col.id)} className="ml-6 p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover/card:opacity-100 transition-all hover:bg-red-50 rounded-lg">
                          <Icons.Plus className="w-6 h-6 rotate-45" />
                        </button>
                      </div>
                      <TransformationPipeline
                        steps={col.transformations}
                        onAddStep={(type) => {
                          const newStep: TransformationStep = { id: `tr_${Date.now()}`, type: type || TransformationType.UPPERCASE };
                          updateColumn(col.id, { transformations: [...col.transformations, newStep] });
                        }}
                        onRemoveStep={(stepId) => updateColumn(col.id, { transformations: col.transformations.filter(s => s.id !== stepId) })}
                        onUpdateStep={(stepId, updates) => updateColumn(col.id, { transformations: col.transformations.map(s => s.id === stepId ? { ...s, ...updates } : s) })}
                        onAiSuggest={async () => {
                          const sourceField = col.sourceField;
                          if (!sourceField) return;

                          // Lookup dataType from selectedGroup
                          const [tableName, fieldName] = sourceField.split('.');
                          const table = selectedGroup?.objects?.find(o => o.tableName === tableName);
                          const field = table?.fields?.find(f => f.name === fieldName);
                          const dataType = field?.type || 'STRING';

                          try {
                            const response = await fetch('http://localhost:3006/api/fbdi/suggest-transformations', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                columnName: col.targetName,
                                sourceField,
                                dataType,
                                moduleContext: selectedGroup?.name
                              })
                            });
                            const result = await response.json();
                            if (Array.isArray(result)) {
                              const newSteps: TransformationStep[] = result.map((item: any, idx: number) => ({
                                id: `tr_ai_${Date.now()}_${idx}`,
                                type: item.type as TransformationType,
                                params: item.params || {}
                              }));
                              updateColumn(col.id, { transformations: [...col.transformations, ...newSteps] });
                            }
                          } catch (e) {
                            console.error("AI Suggestion failed:", e);
                          }
                        }}
                      />
                    </div>
                  ))}
                  <div className="flex flex-col gap-4">
                    <button onClick={addColumn} className="w-full py-8 border-2 border-dashed border-slate-300 rounded-lg text-slate-400 hover:text-[#1e709a] hover:border-[#1e709a]/30 hover:bg-[#e5f1f8]/20 transition-all font-bold flex items-center justify-center gap-3">
                      <Icons.Plus className="w-5 h-5" />
                      Add Mapping Field
                    </button>

                    <button
                      onClick={saveSpecification}
                      className="w-full py-5 bg-[#1e709a] text-white rounded-lg text-sm font-black uppercase tracking-widest shadow-xl shadow-[#1e709a]/20 hover:bg-[#165676] transition-all flex items-center justify-center gap-3"
                    >
                      <Icons.File className="w-5 h-5" />
                      Save Mapping Changes
                    </button>
                  </div>
                </div>
              </div>
            )}


            {/* {!activeSpec && !selectedGroup && location.pathname.startsWith('/fbdi') && !['/fbdi/assistant', '/fbdi/load-to-oracle'].includes(location.pathname) && (
              <div className="py-40 flex flex-col items-center justify-center text-slate-300">
                <Icons.Database className="w-20 h-20 mb-6 opacity-10" />
                <p className="text-xl font-bold tracking-tight">Select a Data Model or Import Architecture</p>
              </div>

            )} */}
          </div>
        </div>
      </main>

      <DatabaseConnectionModal
        isOpen={isDbModalOpen}
        onClose={() => setIsDbModalOpen(false)}
        onSave={handleDbSave}
        isLoading={isAiLoading}
      />
      <ImportModelModal
        isOpen={isImportModalOpen}
        onClose={() => navigate('/fbdi')}
        onImport={handleModelImportFromFile}
        isLoading={isAiLoading} />
      <FBDIImportModal isOpen={isFbdiModalOpen} onClose={() => navigate('/fbdi')} onImport={async (file, mod) => { await handleFbdiSubmit(file, mod); }} isLoading={isAiLoading} />

      {
        activeSpec && (
          <PreviewModal
            isOpen={isPreviewOpen}
            onClose={() => navigate(-1)}
            query={previewSql}
            data={previewData}
            columns={activeSpec.columns}
            isLoading={isPreviewLoading}
            onApplySql={handleApplySqlFromPreview}
          />
        )
      }


      {isExtractingMode && (activeSpec || selectedGroup) && (
        <ExtractionProgressScreen
          onCancel={() => navigate(selectedGroup ? `/fbdi/models/${selectedGroup.id}` : '/fbdi')}
          specName={activeSpec ? activeSpec.name : (selectedGroup?.name || 'Batch Extraction')}
          progress={extractProgress}
          status={extractStatus}
        />

      )}
      {saveLoading && <LoadingScreen message="Saving Specification..." />}
      {fbdiLoading && <LoadingScreen message={extractStatus} progress={extractProgress} />}
      <ManualSqlQueryModal
        isOpen={isManualSqlModalOpen}
        onClose={() => setIsManualSqlModalOpen(false)}
        onApplySqlMapping={handleApplySqlMapping}
      />

      {/* GLOBAL AI ASSISTANT OVERLAY / FULL PAGE */}
      {assistantMode !== 'hidden' && (
        <FBDIAssistant 
          isFullPage={assistantMode === 'full'} 
          onFbdiSubmit={handleFbdiSubmit as any} 
          isOpen={true}
          onClose={() => setAssistantMode('hidden')}
          onToggleMode={() => setAssistantMode(prev => prev === 'overlay' ? 'full' : 'overlay')}
          fusionConfigs={fusionConfigs}
          models={groups}
          onRunExtraction={handleRunExtraction}
          onRunBatchExtraction={handleBatchExtraction}
        />
      )}
    </div>
  );
};


export default App;
