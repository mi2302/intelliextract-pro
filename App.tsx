
import React, { useState, useEffect } from 'react';
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
  DBType
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
import {
  fetchSavedModels,
  fetchSavedModelDetail,
  analyzeFbdiMetadata
} from './services/dbService';
import { analyzeFbdiContent, AgentAnalysis } from './utils/fbdiAnalysis';

const App: React.FC = () => {
  const [groups, setGroups] = useState<ObjectGroup[]>([]);
  const [specifications, setSpecifications] = useState<FileSpecification[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ObjectGroup | null>(null);
  const [activeSpec, setActiveSpec] = useState<FileSpecification | null>(null);

  const [nlQuery, setNlQuery] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isFbdiModalOpen, setIsFbdiModalOpen] = useState(false);
  const [initialSyncLoading, setInitialSyncLoading] = useState(false);
  const [dbConfig, setDbConfig] = useState<DatabaseConfig | null>(null);

  // Preview States
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewSql, setPreviewSql] = useState('');
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Extraction Progress States
  const [isExtractingMode, setIsExtractingMode] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractStatus, setExtractStatus] = useState('');

  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) {
      setSelectedGroup(groups[0]);
    }
  }, [groups]);

  // Sync with DB on mount - Optimized: Only fetch headers, hydrate on demand
  useEffect(() => {
    const syncWithDb = async () => {
      setInitialSyncLoading(true);
      try {
        const { models, latestModelDetail } = await fetchSavedModels();
        if (models.length > 0) {
          const placeholderGroups: ObjectGroup[] = models.map(model => {
            const isLatest = latestModelDetail && model.MODEL_ID === latestModelDetail.group.modelId;
            return {
              id: `grp_db_${model.MODEL_ID}`,
              modelId: model.MODEL_ID,
              name: model.MODEL_NAME,
              databaseType: 'ORACLE',
              objects: isLatest ? latestModelDetail.group.objects : [],
              relationships: isLatest ? latestModelDetail.group.relationships : []
            };
          });

          setGroups(placeholderGroups);

          // If eagerly loaded, update specifications too
          if (latestModelDetail) {
            setSpecifications(prev => {
              const otherSpecs = prev.filter(s => s.objectGroupId !== `grp_db_${latestModelDetail.group.modelId}`);
              return [...otherSpecs, ...latestModelDetail.specifications];
            });
            // Automatically select latest model if none selected
            if (!selectedGroup) {
              setSelectedGroup(placeholderGroups[0]);
            }
          }

          // BACKGROUND PRE-FETCH: Hydrate all other models in background
          const remainingModels = models.slice(1);
          if (remainingModels.length > 0) {
            console.log(`[Background] Starting pre-fetch for ${remainingModels.length} models...`);
            // Sequential background fetch to avoid overloading DB/Server
            const prefetchQueue = async () => {
              for (const model of remainingModels) {
                try {
                  const detail = await fetchSavedModelDetail(model.MODEL_ID);
                  if (detail) {
                    setGroups(prev => prev.map(g => g.id === `grp_db_${model.MODEL_ID}` ? { ...g, objects: detail.group.objects, relationships: detail.group.relationships || [] } : g));
                    setSpecifications(prev => {
                      const otherSpecs = prev.filter(s => s.objectGroupId !== `grp_db_${model.MODEL_ID}`);
                      return [...otherSpecs, ...detail.specifications];
                    });
                  }
                } catch (e) {
                  console.warn(`Background fetch failed for model ${model.MODEL_NAME}:`, e);
                }
              }
              console.log("[Background] Pre-fetch complete.");
            };
            prefetchQueue();
          }
        }
      } catch (error) {
        console.error("Database initialization failed:", error);
      } finally {
        setTimeout(() => setInitialSyncLoading(false), 500);
      }
    };

    syncWithDb();
  }, []);

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

  const handleUpdateGroup = async (updatedGroup: ObjectGroup) => {
    setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
    if (selectedGroup?.id === updatedGroup.id) {
      setSelectedGroup(updatedGroup);
    }

    // Persist to backend if this is a saved model
    if (updatedGroup.modelId) {
      console.log(`Persisting architecture update for model: ${updatedGroup.name}`);
      try {
        await fetch('http://localhost:3006/api/model/update-architecture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelName: updatedGroup.name,
            objects: updatedGroup.objects,
            relationships: updatedGroup.relationships
          })
        });
      } catch (err) {
        console.error("Failed to persist architecture update:", err);
      }
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
    setActiveSpec(newSpec);
    setSelectedGroup(targetGroup);
  };

  const handleCloneSpec = async () => {
    if (!activeSpec || !selectedGroup?.modelId) return;

    console.log(`Cloning extraction '${activeSpec.name}' to a new version...`);
    setIsAiLoading(true);
    try {
      const res = await fetch('http://localhost:3006/api/extraction/update', {
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
      }
    }
  };

  const handleAiGeneration = async () => {
    if (!nlQuery.trim()) return;
    setIsAiLoading(true);
    try {
      const response = await fetch('http://localhost:3006/api/nl-query', {
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

  const handleDbConnect = async (config: DatabaseConfig) => {
    setIsAiLoading(true);
    // Don't close modal immediately, wait for success
    try {
      const { connectAndIntrospect, fetchModuleSchema } = await import('./services/dbService');
      const introspectedGroup = await connectAndIntrospect(config);
      setGroups(prev => [...prev, introspectedGroup]);
      setSelectedGroup(introspectedGroup);
      setDbConfig(config);
      setIsDbModalOpen(false); // Close only on success
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
    } catch (e) {
      alert("Failed to parse data model.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleFbdiImport = () => {
    setIsFbdiModalOpen(true);
  };

  const handleFbdiSubmit = async (file: File, moduleNameOverride: string) => {
    if (!file) return;

    setIsAiLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });

      // 1. Module Name Assignment (Strictly use user provided name)
      const moduleName = moduleNameOverride || file.name.split('_')[0] || 'ImportedModule';

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

      // NEW: Trigger AI Analysis (OCI GenAI via Backend)
      console.log("Triggering AI Metadata Analysis...");
      let analysisModuleNames: string[] = [];
      let analysisIntent = '';
      try {
        const metadata = {
          sheetNames: allSheetNames,
          instructions: '', // Will extract if possible below
          props: (wb.Props || {}) as any,
          fileName: file.name
        };

        // Extract basic instruction snippet if available
        const instSheet = wb.SheetNames.find(n => n.toLowerCase().includes('instruction'));
        if (instSheet) {
          const ws = wb.Sheets[instSheet];
          metadata.instructions = String(ws['A1']?.v || ws['B2']?.v || '').substring(0, 1000);
        }

        const analysis = await analyzeFbdiMetadata(metadata);
        if (analysis) {
          analysisIntent = analysis.intent || '';
          if (analysis.confidence === 'High' && analysis.moduleName) {
            analysisModuleNames = [analysis.moduleName];
          } else if (analysis.possibleModules && analysis.possibleModules.length > 0) {
            analysisModuleNames = analysis.possibleModules;
          } else if (analysis.moduleName) {
            analysisModuleNames = [analysis.moduleName];
          }
          console.log("AI Analysis Result (Modules):", analysisModuleNames, "Intent:", analysisIntent);
        }
      } catch (aiErr) {
        console.warn("AI Analysis failed (non-critical):", aiErr);
      }

      console.log(`Starting FBDI Import for module: ${moduleName}`);

      let dbObjects: any[] = [];
      let fbdiMappings: any[] = [];

      console.log("Extracted Data Sheet Names for DB Lookup:", dataSheetNames);

      // --- Multi-Pass Header Discovery ---
      // 1. Pre-extract headers from all data sheets to support targeted discovery
      const dataSheetInfo: { name: string; headers: string[], sampleRowData?: any[] }[] = [];
      dataSheetNames.forEach(sheetName => {
        const actualSheetName = wb.SheetNames.find(n => n.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === sheetName);
        if (!actualSheetName) return;
        const ws = wb.Sheets[actualSheetName];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const rows = data as any[][];

        let headers: string[] = [];
        const row4 = rows[3] as any[];
        if (row4 && Array.isArray(row4)) {
          const vCols = row4.filter(c => c && (typeof c === 'string' || typeof c === 'number') && String(c).trim().length > 0).length;
          if (vCols > 0) headers = row4.map(r => r ? String(r).trim() : '');
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
              // Pluck up to 5 next rows as sample data if available
              sampleRows = rows.slice(i + 1, i + 6).filter(r => Array.isArray(r)) as any[][];
            }
          }
        } else {
          // Headers were found at row[3], try to get up to 5 sample rows starting from row[4]
          if (rows.length > 4) {
            sampleRows = rows.slice(4, 9).filter(r => Array.isArray(r)) as any[][];
          }
        }
        dataSheetInfo.push({ name: actualSheetName, headers, sampleRows } as any);
      });

      let relationships: any[] = [];
      // 2. Initial Fetch (Pass 1 & 2: Recon + Group Name)
      try {
        console.log("Calling fetchModuleSchema and fetchFbdiMappings (Pass 1 & 2)...");
        const { fetchModuleSchema, fetchFbdiMappings } = await import('./services/dbService');

        const schemaRes = await fetchModuleSchema(dbConfig, moduleName, dataSheetNames, analysisModuleNames);
        dbObjects = schemaRes.objects;
        relationships = schemaRes.relationships;

        fbdiMappings = await fetchFbdiMappings(dbConfig, moduleName, dataSheetNames, analysisModuleNames);

        if (!dbObjects || dbObjects.length === 0) {
          console.warn("No tables found for module:", moduleName);
        } else {
          console.log("Final consolidated tables:", dbObjects.map(o => o.name));
        }
      } catch (err) { console.error("Schema/Mappings Fetch Failed:", err); }

      // 4. Create New Object Group for this FBDI Module
      const groupId = `grp_fbdi_${Date.now()}`;
      const newGroup: ObjectGroup = {
        id: groupId,
        name: moduleName,
        databaseType: 'ORACLE',
        objects: dbObjects,
        relationships: relationships || []
      };

      setGroups(prev => [...prev, newGroup]);
      setSelectedGroup(newGroup);

      // Upload template...
      console.log("Uploading FBDI template to server...");
      let backendTemplateName = '';
      try {
        const formData = new FormData();
        formData.append('template', file);
        const uploadRes = await fetch('http://localhost:3006/api/upload-template', {
          method: 'POST',
          body: formData
        });
        const uploadResult = await uploadRes.json();
        if (uploadResult.success) {
          backendTemplateName = uploadResult.filename;
          console.log("Template staged successfully:", backendTemplateName);
        }
      } catch (err) {
        console.error("Template upload failed", err);
      }

      const wbBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const newSpecs: FileSpecification[] = [];

      // --- PHASE 1 & 2: Initial Mapping Pass ---
      const allUnmappedMandatory: Record<string, string[]> = {};
      const intermediateSpecs: { ds: any, specId: string, mappedColumns: any[] }[] = [];

      dataSheetInfo.forEach(ds => {
        const { name: sheet, headers } = ds;
        if (!headers || headers.length === 0) return;

        const specId = `spec_fbdi_${sheet.replace(/\s+/g, '_')}_${Date.now()}`;
        const cleanSheetName = sheet.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

        const sheetMappings = fbdiMappings.filter(m =>
          (m.DATA_IDENTIFIER || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === cleanSheetName
        );
        const isKnownSheet = sheetMappings.length > 0;
        const allowedTables = new Set(sheetMappings.map(m => (m.TABLE_NAME || '').trim().toUpperCase()).filter(Boolean));

        const unmappedMandatory: string[] = [];
        const mappedColumns = headers.map((h, i) => {
          let bestMatch = '';
          const hClean = h.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          const isMandatory = h.includes('*') || h.includes('**');

          // TIER 1: Recon Mapping
          if (isKnownSheet) {
            let mappingMatch = sheetMappings.find(m => {
              const mHeaderClean = (m.METADATA_COLUMN_HEADER || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
              return mHeaderClean === hClean && m.COLUMN_NAME;
            });

            if (!mappingMatch) {
              mappingMatch = sheetMappings.find(m => {
                const mHeaderClean = (m.METADATA_COLUMN_HEADER || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                return mHeaderClean.includes(hClean) && m.COLUMN_NAME;
              });
            }

            if (mappingMatch && mappingMatch.TABLE_NAME && mappingMatch.COLUMN_NAME) {
              const matchedObj = dbObjects.find(o => (o.tableName || '').toUpperCase() === mappingMatch.TABLE_NAME.trim().toUpperCase());
              const matchedCol = mappingMatch.COLUMN_NAME.trim();
              if (matchedObj?.fields?.some((f: any) => (f.name || '').toUpperCase() === matchedCol.toUpperCase())) {
                bestMatch = `${matchedObj!.name}.${matchedCol}`;
              }
            }
          }

          // TIER 2: Module Semantic Fallback
          if (!bestMatch) {
            const objectsToSearch = isKnownSheet ? dbObjects.filter(o => allowedTables.has((o.tableName || '').toUpperCase())) : dbObjects;

            // Literal
            for (const obj of objectsToSearch) {
              const matchedField = obj.fields?.find((f: any) => {
                const fNameClean = (f.name || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                return fNameClean === hClean || hClean.includes(fNameClean) || fNameClean.includes(hClean);
              });
              if (matchedField) {
                bestMatch = `${obj.name}.${matchedField.name}`;
                break;
              }
            }

            // Semantic
            if (!bestMatch) {
              const hWords = h.toLowerCase().split(' ').filter(w => w.length > 3);
              for (const obj of objectsToSearch) {
                const matchedField = obj.fields?.find((f: any) => {
                  const desc = (f.description || '').toLowerCase();
                  return hWords.length > 0 && hWords.every(word => desc.includes(word));
                });
                if (matchedField) {
                  bestMatch = `${obj.name}.${matchedField.name}`;
                  break;
                }
              }
            }
          }

          if (!bestMatch && isMandatory) unmappedMandatory.push(h);

          return { id: `col_${specId}_${i}`, sourceField: bestMatch || '', targetName: h, transformations: [] };
        });

        if (unmappedMandatory.length > 0) allUnmappedMandatory[sheet] = unmappedMandatory;
        intermediateSpecs.push({ ds, specId, mappedColumns });
      });

      // --- PHASE 3: Global Mandatory Discovery ---
      if (Object.keys(allUnmappedMandatory).length > 0) {
        console.log("[Phase 3] Triggering Global Discovery for Mandatory Headers...");
        const pass3Res = await fetch('http://localhost:3006/api/fbdi-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleName, unmappedHeaders: allUnmappedMandatory, analysisModuleName: analysisModuleNames })
        });
        const pass3Data = await pass3Res.json();
        const globalMappings = pass3Data.mappings || [];

        // Update Architecture with any NEW tables found in Phase 3
        const newTables = [...new Set(globalMappings.map((m: any) => m.TABLE_NAME))].filter(t => !dbObjects.some(o => (o.tableName || '').toUpperCase() === String(t).toUpperCase()));
        if (newTables.length > 0) {
          console.log("[Phase 3] Fetching and Merging new tables:", newTables);
          const newArchRes = await fetch('http://localhost:3006/api/module-columns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ moduleName, sheetNames: dataSheetNames, unmappedHeaders: allUnmappedMandatory, analysisModuleName: analysisModuleNames })
          });
          const newArchData = await newArchRes.json();
          if (newArchData.objects) {
            newArchData.objects.forEach((obj: any) => {
              if (!dbObjects.some(o => o.tableName === obj.tableName)) dbObjects.push(obj);
            });
          }
          if (newArchData.relationships) {
            newArchData.relationships.forEach((rel: any) => relationships.push(rel));
          }
        }

        // Patch intermediateSpecs with Phase 3 results
        intermediateSpecs.forEach(spec => {
          spec.mappedColumns.forEach(col => {
            if (!col.sourceField && (col.targetName.includes('*') || col.targetName.includes('**'))) {
              const hTargetClean = col.targetName.replace(/\*/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

              // Find the best match in the global mappings returned by AI
              const match = globalMappings.find((m: any) => {
                const mId = String(m.DATA_IDENTIFIER || '');
                const mIdClean = mId.replace(/\*/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                return mId.toUpperCase() === col.targetName.toUpperCase() || mIdClean === hTargetClean;
              });

              if (match) {
                const obj = dbObjects.find(o => (o.tableName || '').toUpperCase() === String(match.TABLE_NAME).toUpperCase());
                if (obj) {
                  col.sourceField = `${obj.name}.${match.COLUMN_NAME}`;
                  console.log(`[Phase 3 Match] Resolved mandatory header '${col.targetName}' to ${col.sourceField} (Table: ${match.TABLE_NAME}) via AI-vetted global discovery`);
                }
              }
            }
          });
        });
      }

      // --- FINALIZATION: Build Specs and Filters ---
      intermediateSpecs.forEach(is => {
        const { ds, specId, mappedColumns } = is;
        const autoFilters: FilterCondition[] = [];
        if (ds.sampleRows && Array.isArray(ds.sampleRows)) {
          mappedColumns.forEach((col: any, idx: number) => {
            if (col.sourceField) {
              const uniqueValues = new Set<string>();
              ds.sampleRows.forEach((row: any) => {
                const val = row[idx] ? String(row[idx]).trim() : '';
                if (val && val.length > 0) uniqueValues.add(val);
              });
              uniqueValues.forEach(val => {
                autoFilters.push({
                  id: `filt_${Date.now()}_${idx}_${val.substring(0, 5)}`,
                  field: col.sourceField,
                  operator: FilterOperator.EQUALS,
                  value: val
                });
              });
            }
          });
        }

        const newSpec: FileSpecification = {
          id: specId,
          objectGroupId: groupId,
          name: `FBDI - ${ds.name}`,
          createdAt: new Date().toISOString(),
          version: 1.0,
          format: ExportFormat.FBDI,
          columns: mappedColumns,
          filters: autoFilters,
          templateData: wbBase64,
          sheetName: ds.name,
          backendTemplateName: backendTemplateName
        };
        newSpecs.push(newSpec);
      });

      if (newSpecs.length > 0) {
        setSpecifications(prev => [...prev, ...newSpecs]);
        setActiveSpec(null); // Show Source Architecture

        // 4. Persist Model & Architecture to Database
        console.log("Persisting model metadata to database...");
        try {
          const saveRes = await fetch('http://localhost:3006/api/save-model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              modelName: moduleName,
              templateName: file.name,
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
            // Update the group with the real modelId from DB
            setGroups(prev => prev.map(g => g.id === groupId ? { ...g, modelId: saveResult.modelId } : g));
            if (selectedGroup?.id === groupId) {
              setSelectedGroup(prev => prev ? { ...prev, modelId: saveResult.modelId } : null);
            }
          } else {
            console.error("Failed to persist model:", saveResult.message);
          }
        } catch (saveErr) {
          console.error("Error calling save-model API:", saveErr);
        }

        alert(`Imported ${newSpecs.length} Specs for Module '${moduleName}'. Architecture saved to DB.`);
        setIsFbdiModalOpen(false);
      } else {
        alert("No valid sheets/headers found in FBDI file.");
      }

    } catch (err: any) {
      console.error(err);
      alert("Failed to parse FBDI file: " + err.message);
    } finally {
      setIsAiLoading(false);
    }
  };

  const saveSpecification = async () => {
    if (!activeSpec) return;

    // Persist to Backend if model exists
    if (selectedGroup?.modelId) {
      console.log(`Saving extraction '${activeSpec.name}' (Version: ${activeSpec.version}) to backend...`);
      try {
        const res = await fetch('http://localhost:3006/api/extraction/update', {
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
        if (result.success) {
          console.log(`Extraction version ${result.version} saved successfully.`);
          alert(`Version ${result.version} saved!`);
        } else {
          console.error("Failed to save extraction:", result.message);
          alert("Failed to save: " + result.message);
        }
      } catch (err) {
        console.error("Error calling update extraction API:", err);
      }
    } else {
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

    setIsPreviewOpen(true);
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
        const [objName, colName] = f.field.split('.');
        const obj = selectedGroup.objects.find(o => o.name === objName);
        const physicalTable = obj ? obj.tableName : objName;
        return {
          ...f,
          field: `${physicalTable}.${colName}`
        };
      });

      const response = await fetch('http://localhost:3006/api/generate-sql', {
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
          const dataResponse = await fetch('http://localhost:3006/api/extract', {
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

  const handleRunExtraction = async (targetSpec?: FileSpecification, formatOverride?: ExportFormat) => {
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

    setExportLoading(true);
    setIsExtractingMode(true);
    setExtractProgress(0);
    setExtractStatus('Initializing extraction engine...');

    try {
      // Step 1: Initialization
      await new Promise(r => setTimeout(r, 400));
      setExtractProgress(15);
      setExtractStatus('Validating data model and security tokens...');

      // Step 2: Model Validation & Mapping
      await new Promise(r => setTimeout(r, 500));
      setExtractProgress(35);
      setExtractStatus('Building optimized Oracle SQL queries (ATP)...');

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
        const [objName, colName] = f.field.split('.');
        const obj = selectedGroup.objects.find(o => o.name === objName);
        const physicalTable = obj ? obj.tableName : objName;
        return { ...f, field: `${physicalTable}.${colName}` };
      });

      // Step 3: Database Query (The long pole)
      setExtractProgress(50);
      setExtractStatus('Executing data fetch on Oracle Database...');

      const response = await fetch('http://localhost:3006/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: columnsPayload,
          joins: joinsPayload,
          filters: filtersPayload,
          templateFile: spec.backendTemplateName,
          sheetName: spec.sheetName,
          exportFormat: format
        })
      });

      setExtractProgress(75);
      setExtractStatus('Processing database response and mapping schemas...');

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
      setExtractStatus(format === ExportFormat.FBDI ? 'Generating FBDI ZIP package...' : 'Formatting data for Excel/CSV...');

      if (format === ExportFormat.FBDI) {
        const blob = await response.blob();
        setExtractProgress(95);
        setExtractStatus('Finalizing extraction package...');
        await new Promise(r => setTimeout(r, 300));

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fileName = `${spec.name.replace(/\s+/g, '_')}_v${Number(spec.version).toFixed(1)}.zip`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        setExtractProgress(100);
        setExtractStatus('Success! Package ready.');
        await new Promise(r => setTimeout(r, 1000));
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
          const fileName = `${spec.name.replace(/\s+/g, '_')}_v${Number(spec.version).toFixed(1)}.csv`;
          link.setAttribute("download", fileName);
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } else {
          alert(`${format.toUpperCase()} export complete.`);
        }

        setExtractProgress(100);
        setExtractStatus('Extraction Successful!');
        await new Promise(r => setTimeout(r, 1000));
      } else {
        throw new Error(result.message || 'Unknown error');
      }
    } catch (e: any) {
      console.error("Extraction failed", e);
      alert("Error: " + e.message);
    } finally {
      setExportLoading(false);
      setIsExtractingMode(false);
    }
  };

  const handleBatchExtraction = async (format: ExportFormat) => {
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

    setExportLoading(true);
    setIsExtractingMode(true);
    setExtractProgress(0);
    setExtractStatus(`Preparing batch extraction for ${groupSpecs.length} sheets...`);

    try {
      // Step 1: Initialization & Validation
      await new Promise(r => setTimeout(r, 400));
      setExtractProgress(15);
      setExtractStatus('Building optimized parallel extraction pipelines...');
      // Prepare specs for backend
      const specsPayload = groupSpecs.map(spec => {
        const columns = spec.columns.map(col => {
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
          const [objName, colName] = f.field.split('.');
          const obj = selectedGroup.objects.find(o => o.name === objName);
          const physicalTable = obj ? obj.tableName : objName;
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
          id: spec.id
        };
      });

      // Step 2: Parallel SQL Construction
      await new Promise(r => setTimeout(r, 600));
      setExtractProgress(35);
      setExtractStatus(`Connecting to Oracle ATP - Executing ${specsPayload.length} extracts in parallel...`);

      const response = await fetch('http://localhost:3006/api/extract-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specs: specsPayload,
          exportFormat: format,
          templateFile: groupSpecs[0]?.backendTemplateName
        })
      });

      setExtractProgress(65);
      setExtractStatus('Merging results and generating unified FBDI ZIP...');

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

      if (format === ExportFormat.FBDI) {
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
        const fileName = `${selectedGroup.name.replace(/\s+/g, '_')}_Consolidated_FBDI.zip`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        setExtractProgress(100);
        setExtractStatus('Batch Extraction Successful!');
        await new Promise(r => setTimeout(r, 1000));
        return;
      }

      const result = await response.json();
      if (result.success) {
        setExtractProgress(100);
        setExtractStatus('Success! Batch download ready.');
        await new Promise(r => setTimeout(r, 1000));
      } else {
        throw new Error(result.message || 'Unknown error');
      }
    } catch (err: any) {
      console.error("Batch extraction failed", err);
      alert("Error: " + err.message);
    } finally {
      setExportLoading(false);
      setIsExtractingMode(false);
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
        sourceField: `${defaultObj.name}.${defaultField}`,
        targetName: 'EXTRACT_FIELD',
        transformations: []
      }]
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
        field: `${defaultObj.name}.${defaultField}`,
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

  const handleApplySqlFromPreview = (sql: string) => {
    if (!activeSpec || !selectedGroup) return;

    // This regex looks for patterns like: TABLE_NAME.COLUMN_NAME AS "Alias Name"
    // OR "TABLE_NAME"."COLUMN_NAME" AS "Alias" 
    // And tries to map it back to the UI target names

    // Very naive SQL parser to scrape AS clauses out
    const selectMatch = sql.match(/SELECT([\s\S]*?)FROM/i);
    if (!selectMatch) {
      alert("Invalid SQL: Could not find SELECT ... FROM block.");
      return;
    }

    const selectContent = selectMatch[1];

    // Split by commas, considering quotes
    const clauses = selectContent.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);

    let matchCount = 0;
    const updatedColumns = [...activeSpec.columns];

    clauses.forEach(clause => {
      // Trying to match:   "TABLE"."FIELD" AS "TARGET ALIAS"
      // or:                 TABLE.FIELD AS "TARGET ALIAS"
      // or:                 'CONST' AS "TARGET ALIAS"
      const parts = clause.split(/\s[Aa][Ss]\s/);
      if (parts.length >= 2) {
        const rawSource = parts[0].trim();
        let targetAlias = parts[1].trim().replace(/^"|"$/g, ''); // Remove wrapping quotes

        // Find existing column in spec by alias
        const targetColIndex = updatedColumns.findIndex(c => c.targetName === targetAlias);

        if (targetColIndex > -1) {
          let parsedSource = '';
          let cleanSource = rawSource.replace(/"/g, '').trim(); // Remove quotes TABLE.FIELD

          // Strip out function wrappers if it's simple like UPPER()
          if (cleanSource.toUpperCase().startsWith('UPPER(')) cleanSource = cleanSource.substring(6, cleanSource.length - 1);
          if (cleanSource.toUpperCase().startsWith('LOWER(')) cleanSource = cleanSource.substring(6, cleanSource.length - 1);
          if (cleanSource.toUpperCase().startsWith('TRIM(')) cleanSource = cleanSource.substring(5, cleanSource.length - 1);

          // If it has a table dot
          if (cleanSource.includes('.')) {
            const [dbTable, dbField] = cleanSource.split('.');

            // Look up table in Group Objects to get the nice obj.name
            const matchedObj = selectedGroup.objects.find(o => (o.tableName || '').toUpperCase() === dbTable.toUpperCase() || (o.name || '').toUpperCase() === dbTable.toUpperCase());
            if (matchedObj) {
              parsedSource = `${matchedObj.name}.${dbField}`;
            } else {
              parsedSource = cleanSource; // fallback
            }

            updatedColumns[targetColIndex] = {
              ...updatedColumns[targetColIndex],
              sourceField: parsedSource
            };
            matchCount++;
          }
        }
      }
    });

    if (matchCount > 0) {
      const newSpec = { ...activeSpec, columns: updatedColumns };
      setActiveSpec(newSpec);
      setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
      setIsPreviewOpen(false); // Close preview to show UI
      alert(`Success: Mapped ${matchCount} columns from pasted SQL query!`);
    } else {
      alert("No corresponding UI fields matched the provided SQL AS aliases. Note: The alias in the SQL must perfectly match the Output Label Header.");
    }
  };

  const updateSpecName = (name: string) => {
    if (!activeSpec) return;
    const newSpec = { ...activeSpec, name };
    setActiveSpec(newSpec);
    setSpecifications(prev => prev.map(s => s.id === newSpec.id ? newSpec : s));
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900">
      {initialSyncLoading && <LoadingScreen message="IntelliExtract Sync Progress..." />}
      <Sidebar
        groups={groups}
        selectedGroupId={selectedGroup?.id || null}
        activeSpecId={activeSpec?.id || null}
        onGroupSelect={(id) => {
          const group = groups.find(g => g.id === id) || null;
          setSelectedGroup(group);
          setActiveSpec(null);
          if (id.startsWith('grp_db_')) {
            hydrateGroup(id);
          }
        }}
        onCreateSpec={handleCreateNewSpec}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 min-h-[80px] flex items-center px-8 gap-6 shadow-sm z-10">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="E.g., 'Generate an extract for active suppliers with their tax rates...'"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-12 pr-4 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
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

          <div className="flex items-center gap-2">
            <button onClick={handleFbdiImport} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-all shadow-lg shadow-green-500/20">
              <Icons.Upload className="w-4 h-4" /> FBDI Import
            </button>
            <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium border border-slate-200 hover:bg-slate-200">
              <Icons.Search className="w-4 h-4" /> REST API Search
            </button>
            <button onClick={() => setIsImportModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 transition-all shadow-lg shadow-purple-500/20">
              <Icons.Upload className="w-4 h-4" /> Import Model
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          <div className="max-w-6xl mx-auto space-y-8">
            {!activeSpec && selectedGroup && (
              <DataModelView
                group={selectedGroup}
                specifications={specifications.filter(s => s.objectGroupId === selectedGroup.id)}
                onUpdateGroup={handleUpdateGroup}
                onSelectSpec={setActiveSpec}
                onCreateSpec={() => handleCreateNewSpec(selectedGroup.id)}
                onDeleteSpec={handleDeleteSpec}
                onRunExtraction={(format) => {
                  console.log(`Running batch extraction in ${format} format for group ${selectedGroup.id}`);
                  handleBatchExtraction(format);
                }}
              />
            )}

            {activeSpec && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center justify-between">
                  <div className="flex items-center gap-6">
                    <button
                      onClick={() => setActiveSpec(null)}
                      className="p-2 text-slate-400 hover:text-blue-600 bg-slate-50 rounded-xl border border-slate-100 transition-all hover:bg-blue-50"
                      title="Back to Model Architecture"
                    >
                      <Icons.Play className="w-4 h-4 rotate-180" />
                    </button>
                    <div>
                      <div className="flex items-center gap-3">
                        <input
                          className="text-2xl font-bold text-slate-800 tracking-tight bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-100 rounded px-1"
                          value={activeSpec.name}
                          onChange={(e) => updateSpecName(e.target.value)}
                        />
                        <span className="text-[10px] bg-purple-100 text-purple-600 px-3 py-1 rounded-full font-black uppercase tracking-widest border border-purple-200">v{Number(activeSpec.version).toFixed(1)}</span>
                      </div>
                      <p className="text-slate-400 text-xs mt-1 font-medium">Model Context: <span className="text-blue-600 font-bold">{selectedGroup?.name}</span> <span className="mx-2">•</span> Dialect: <span className={`${selectedGroup?.databaseType === 'ORACLE' ? 'text-orange-600' : 'text-blue-600'} font-bold`}>{selectedGroup?.databaseType}</span></p>
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
                        <option value={ExportFormat.PIPE}>PIPE</option>
                      </select>
                    </div>
                    <div className="flex gap-2 items-end">
                      <button onClick={handleCloneSpec} className="p-2.5 bg-slate-50 text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-100 transition-all" title="Save as New Version (Clone)">
                        <Icons.Copy className="w-5 h-5" />
                      </button>
                      <button onClick={handleDownloadExcel} className="p-2.5 bg-slate-50 text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-100 transition-all" title="Download Specification (Excel)">
                        <Icons.Download className="w-5 h-5" />
                      </button>
                      <button onClick={handleOpenPreview} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-500/20 hover:bg-blue-500 transition-all flex items-center gap-2">
                        <Icons.Brain className="w-4 h-4" /> Data Preview & SQL Query
                      </button>
                      <button onClick={saveSpecification} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold shadow-sm hover:bg-slate-50 transition-all flex items-center gap-2">
                        <Icons.File className="w-4 h-4" /> Save Specification
                      </button>
                      <button
                        onClick={() => handleRunExtraction()}
                        disabled={exportLoading}
                        className="px-8 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-green-500/30 hover:bg-green-700 transition-all disabled:opacity-50"
                      >
                        {exportLoading ? 'Processing...' : 'Run Extraction'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Filters Section */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100">
                        <Icons.Settings className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Data Filters</h3>
                        <p className="text-[10px] text-slate-400 font-bold">Restrict output based on specific criteria</p>
                      </div>
                    </div>
                    <button
                      onClick={addFilter}
                      className="text-xs bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-600 px-3 py-1.5 rounded-lg font-bold transition-all border border-slate-200"
                    >
                      + Add Filter
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(activeSpec.filters || []).length === 0 && (
                      <div className="py-4 border border-dashed border-slate-200 rounded-xl text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        No active filters. Extracting full dataset.
                      </div>
                    )}
                    {(activeSpec.filters || []).map(filter => (
                      <div key={filter.id} className="flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-200">
                        <div className="flex-1">
                          <select
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                            value={filter.field}
                            onChange={(e) => updateFilter(filter.id, { field: e.target.value })}
                          >
                            {selectedGroup?.objects?.map(obj => (
                              <optgroup key={obj.id} label={obj.name}>
                                {obj.fields?.map(f => (
                                  <option key={`${obj.name}.${f.name}`} value={`${obj.name}.${f.name}`}>
                                    {obj.tableName}.{f.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        <div className="w-32">
                          <select
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold text-blue-600 outline-none focus:ring-1 focus:ring-blue-500 transition-all"
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
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-medium text-slate-800 outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                            placeholder="Enter value..."
                            value={filter.value}
                            onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                          />
                        </div>
                        <button onClick={() => removeFilter(filter.id)} className="p-2 text-slate-300 hover:text-red-500 transition-all hover:bg-red-50 rounded-lg">
                          <Icons.Plus className="w-5 h-5 rotate-45" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6 pb-40">
                  <div className="flex items-center gap-3 px-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600 border border-purple-100">
                      <Icons.File className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Column Mapping</h3>
                      <p className="text-[10px] text-slate-400 font-bold">Define the structure and content of your extract</p>
                    </div>
                  </div>
                  {activeSpec.columns.length === 0 && (
                    <div className="py-20 bg-white border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400">
                      <Icons.File className="w-12 h-12 mb-4 opacity-10" />
                      <p className="font-bold text-sm">No extraction fields defined.</p>
                    </div>
                  )}
                  {activeSpec.columns.map((col) => (
                    <div key={col.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 relative group/card hover:shadow-md transition-all">
                      <div className="absolute top-0 left-0 w-2 h-full bg-purple-500 rounded-l-2xl"></div>
                      <div className="flex justify-between items-start mb-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-widest">Output Label (Header)</label>
                            <input
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-purple-500 outline-none transition-all"
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
                                  value: `${obj.name}.${f.name}`,
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
                        onAiSuggest={() => console.log("AI Suggestion disabled")}
                      />
                    </div>
                  ))}
                  <div className="flex flex-col gap-4">
                    <button onClick={addColumn} className="w-full py-8 border-2 border-dashed border-slate-300 rounded-2xl text-slate-400 hover:text-purple-600 hover:border-purple-400 hover:bg-purple-50 transition-all font-bold flex items-center justify-center gap-3">
                      <Icons.Plus className="w-5 h-5" />
                      Add Mapping Field
                    </button>

                    <button
                      onClick={saveSpecification}
                      className="w-full py-5 bg-purple-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl shadow-purple-500/20 hover:bg-purple-700 transition-all flex items-center justify-center gap-3"
                    >
                      <Icons.File className="w-5 h-5" />
                      Save Mapping Changes
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!activeSpec && !selectedGroup && (
              <div className="py-40 flex flex-col items-center justify-center text-slate-300">
                <Icons.Database className="w-20 h-20 mb-6 opacity-10" />
                <p className="text-xl font-bold tracking-tight">Select a Data Model or Import Architecture</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <DatabaseConnectionModal
        isOpen={isDbModalOpen}
        onClose={() => setIsDbModalOpen(false)}
        onConnect={handleDbConnect}
        isLoading={isAiLoading}
      />
      <ImportModelModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onImport={handleModelImportFromFile} isLoading={isAiLoading} />
      <FBDIImportModal isOpen={isFbdiModalOpen} onClose={() => setIsFbdiModalOpen(false)} onImport={handleFbdiSubmit} isLoading={isAiLoading} />

      {
        activeSpec && (
          <PreviewModal
            isOpen={isPreviewOpen}
            onClose={() => setIsPreviewOpen(false)}
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
          specName={activeSpec ? activeSpec.name : (selectedGroup?.name || 'Batch Extraction')}
          progress={extractProgress}
          status={extractStatus}
          onCancel={() => setIsExtractingMode(false)}
        />
      )}
    </div >
  );
};

export default App;
