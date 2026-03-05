
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
import {
  processNaturalLanguageQuery,
  suggestTransformations,
  introspectDatabase,
  inferModelFromFile,
  generateSQLFromSpec,
  generateMockDataForSpec,
  analyzeFbdiMetadata
} from './services/geminiService';
import {
  fetchSavedModels,
  fetchSavedModelDetail
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

  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) {
      setSelectedGroup(groups[0]);
    }
  }, [groups]);

  // Sync with DB on mount
  useEffect(() => {
    const syncWithDb = async () => {
      setInitialSyncLoading(true);
      try {
        const savedModels = await fetchSavedModels();
        if (savedModels.length > 0) {
          const allGroups: ObjectGroup[] = [];
          const allSpecs: FileSpecification[] = [];

          for (const model of savedModels) {
            const detail = await fetchSavedModelDetail(model.MODEL_ID);
            if (detail) {
              allGroups.push(detail.group);
              allSpecs.push(...detail.specifications);
            }
          }

          setGroups(allGroups);
          setSpecifications(allSpecs);
        }
      } catch (error) {
        console.error("Database initialization failed:", error);
      } finally {
        setTimeout(() => setInitialSyncLoading(false), 800); // Small delay for visual smoothness
      }
    };

    syncWithDb();
  }, []);

  const handleUpdateGroup = (updatedGroup: ObjectGroup) => {
    setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
    if (selectedGroup?.id === updatedGroup.id) {
      setSelectedGroup(updatedGroup);
    }
  };

  const handleCreateNewSpec = (groupId?: string) => {
    const targetGroup = groupId ? groups.find(g => g.id === groupId) : selectedGroup;
    if (!targetGroup) return;

    const newSpec: FileSpecification = {
      id: `spec_${Date.now()}`,
      name: `New Extraction Task`,
      version: 1.0,
      objectGroupId: targetGroup.id,
      columns: [],
      filters: [],
      format: ExportFormat.CSV,
      createdAt: new Date().toISOString(),
    };

    setSpecifications(prev => [...prev, newSpec]);
    setActiveSpec(newSpec);
    setSelectedGroup(targetGroup);
  };

  const handleCloneSpec = () => {
    if (!activeSpec) return;
    const cloned: FileSpecification = {
      ...activeSpec,
      id: `spec_clone_${Date.now()}`,
      name: `${activeSpec.name} (Copy)`,
      version: 1.0,
      createdAt: new Date().toISOString(),
    };
    setSpecifications(prev => [...prev, cloned]);
    setActiveSpec(cloned);
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
      const result = await processNaturalLanguageQuery(nlQuery, groups);
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
      let importedGroup = parsedGroup || await inferModelFromFile(fileName, content, dialect);

      // Feature: Module-Based Schema Lookup (Revised)
      // Query DB for tables related to this Module Name
      if (importedGroup.name) {
        try {
          const { fetchModuleSchema } = await import('./services/dbService');
          const dbObjects = await fetchModuleSchema(dbConfig, importedGroup.name);

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
      let analysisModuleName = '';
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
        if (analysis && analysis.moduleName) {
          analysisModuleName = analysis.moduleName;
          console.log("AI Analysis Result (analysis_module_name):", analysisModuleName);
        }
      } catch (aiErr) {
        console.warn("AI Analysis failed (non-critical):", aiErr);
      }

      console.log(`Starting FBDI Import for module: ${moduleName}`);

      let dbObjects: any[] = [];
      let fbdiMappings: any[] = [];

      console.log("Extracted Data Sheet Names for DB Lookup:", dataSheetNames);

      // 2. Fetch Schema from DB (Using Backend .env creds if dbConfig is null)
      try {
        console.log("Calling fetchModuleSchema and fetchFbdiMappings...");
        const { fetchModuleSchema, fetchFbdiMappings } = await import('./services/dbService');

        // Pass dbConfig (or null) - backend uses .env if invalid credentials
        dbObjects = await fetchModuleSchema(dbConfig, moduleName, dataSheetNames, analysisModuleName);
        fbdiMappings = await fetchFbdiMappings(dbConfig, moduleName, dataSheetNames, analysisModuleName);

        if (!dbObjects || dbObjects.length === 0) {
          console.warn("No tables found for module:", moduleName);
        } else {
          console.log("Found tables for module:", moduleName, dbObjects.map(o => o.name));
        }

        if (!fbdiMappings || fbdiMappings.length === 0) {
          console.warn("No exact FBDI mappings found for module:", moduleName);
        } else {
          console.log(`Found ${fbdiMappings.length} exact FBDI mappings for module:`, moduleName);
        }
      } catch (err) { console.error("Schema/Mappings Fetch Failed:", err); }

      // 3. Create New Object Group for this FBDI Module
      const groupId = `grp_fbdi_${Date.now()}`;
      const newGroup: ObjectGroup = {
        id: groupId,
        name: moduleName,
        databaseType: 'ORACLE',
        objects: dbObjects,
        relationships: []
      };

      setGroups(prev => [...prev, newGroup]);
      setSelectedGroup(newGroup);

      // Upload original template to server for Python population
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

      // Convert workbook for frontend persistent storage (legacy fallback)
      const wbBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      const newSpecs: FileSpecification[] = [];

      const sheetNames = wb.SheetNames; // Get sheet names once
      sheetNames.forEach(sheet => {
        const ws = wb.Sheets[sheet];
        // Parse raw data to find headers
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const rows = data as any[][];

        // FBDI Standard Header Extraction: Row 4 (index 3)
        let headers: string[] = [];
        let maxCols = 0;

        // Check if row 4 exists and has a significant number of columns (likely an FBDI template)
        const row4 = rows[3] as any[];
        if (row4 && Array.isArray(row4)) {
          const validCols = row4.filter(c => c && (typeof c === 'string' || typeof c === 'number') && String(c).trim().length > 0).length;
          if (validCols > 0) {
            headers = row4.map(r => r ? String(r).trim() : '');
          }
        }

        // Fallback for non-FBDI or malformed files: Scan first 20 rows for max columns
        if (!headers || headers.length === 0) {
          const scanLimit = Math.min(rows.length, 20);
          for (let i = 0; i < scanLimit; i++) {
            const row = rows[i] as any[];
            if (!row || !Array.isArray(row)) continue;
            const validCols = row.filter(c => c && (typeof c === 'string' || typeof c === 'number') && String(c).trim().length > 0).length;

            if (validCols > maxCols) {
              maxCols = validCols;
              headers = row.map(r => r ? String(r).trim() : '');
            }
          }
        }

        if (headers && headers.length > 0) {
          const specId = `spec_fbdi_${sheet.replace(/\s+/g, '_')}_${Date.now()}`;

          // Clean up the sheet name for matching with DATA_IDENTIFIER
          const cleanSheetName = sheet.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          console.log("Sheet name for matching:", cleanSheetName);
          // Enhanced Auto-Map Logic
          const mappedColumns = headers.map((h, i) => {
            let bestMatch = '';
            let bestScore = 0;

            // 1. Exact Mapping from Database (XX_INTELLI_RECON_TAB_COLUMN_MAPPING)
            let potentialTableName = '';
            if (fbdiMappings && fbdiMappings.length > 0) {
              const sheetMapping = fbdiMappings.find(m => {
                const mSheet = (m.DATA_IDENTIFIER || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                return mSheet === cleanSheetName;
              });

              if (sheetMapping) {
                potentialTableName = sheetMapping.TABLE_NAME;
              }

              const exactMapping = fbdiMappings.find(m => {
                const mSheet = (m.DATA_IDENTIFIER || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                // Normalize metadata business name and source header
                const mBusinessNormalized = (m.METADATA_COLUMN_HEADER || '').replace(/[^A-Z0-9]/g, '').toUpperCase();
                const hNormalized = h.replace(/[^A-Z0-9]/g, '').toUpperCase();

                // USER REQUIREMENT: Business column contains source header (normalized)
                return mSheet === cleanSheetName && mBusinessNormalized.includes(hNormalized) && m.COLUMN_NAME;
              });

              if (exactMapping && exactMapping.TABLE_NAME && exactMapping.COLUMN_NAME) {
                const matchedObj = dbObjects.find(o => (o.tableName || '').toUpperCase() === exactMapping.TABLE_NAME.trim().toUpperCase());
                const matchedCol = exactMapping.COLUMN_NAME.trim();

                let columnExists = false;
                if (matchedObj && matchedObj.fields) {
                  columnExists = matchedObj.fields.some((f: any) => (f.name || '').toUpperCase() === matchedCol.toUpperCase());
                }

                if (columnExists) {
                  bestMatch = `${matchedObj!.name}.${matchedCol}`;
                  bestScore = 100;
                  console.log(`[Metadata Match] Linked Header '${h}' to ${bestMatch} via Business Column '${exactMapping.METADATA_COLUMN_HEADER}'`);
                }
              }
            }

            // 2. FALLBACK: Search discovered master tables (dbObjects) for this header
            if (!bestMatch) {
              const hClean = h.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

              // Sort dbObjects to prioritize the potentialTableName found in mappings
              const sortedObjects = [...dbObjects].sort((a, b) => {
                if (potentialTableName && a.tableName?.toUpperCase() === potentialTableName.toUpperCase()) return -1;
                if (potentialTableName && b.tableName?.toUpperCase() === potentialTableName.toUpperCase()) return 1;
                return 0;
              });

              for (const obj of sortedObjects) {
                const matchedField = obj.fields?.find((f: any) => {
                  const fNameClean = (f.name || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                  return fNameClean === hClean || hClean.includes(fNameClean) || fNameClean.includes(hClean);
                });

                if (matchedField) {
                  bestMatch = `${obj.name}.${matchedField.name}`;
                  console.log(`[Fallback Match] Linked Header '${h}' to ${obj.name} Table Column '${bestMatch}'`);
                  break;
                }
              }
            }

            return {
              id: `col_${specId}_${i}`,
              sourceField: bestMatch || '',
              targetName: h,
              transformations: []
            };
          });

          const newSpec: FileSpecification = {
            id: specId,
            objectGroupId: groupId,
            name: `FBDI - ${sheet}`,
            createdAt: new Date().toISOString(),
            version: 1.0,
            format: ExportFormat.FBDI,
            columns: mappedColumns,
            filters: [],
            templateData: wbBase64,
            sheetName: sheet,
            backendTemplateName: backendTemplateName
          };
          newSpecs.push(newSpec);
        }
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

    const updated = { ...activeSpec, version: parseFloat((activeSpec.version + 0.1).toFixed(1)) };
    setSpecifications(prev => prev.map(s => s.id === activeSpec.id ? updated : s));
    setActiveSpec(updated);

    // Persist to Backend if model exists
    if (selectedGroup?.modelId) {
      console.log(`Saving extraction '${activeSpec.name}' to backend for Model ID: ${selectedGroup.modelId}`);
      try {
        const res = await fetch('http://localhost:3006/api/extraction/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelId: selectedGroup.modelId,
            extractionName: activeSpec.name,
            columns: activeSpec.columns,
            sqlQuery: '', // You can add actual SQL generation here if needed
            templateName: activeSpec.name // fallback
          })
        });
        const result = await res.json();
        if (result.success) {
          console.log("Extraction saved successfully to database.");
        } else {
          console.error("Failed to save extraction:", result.message);
        }
      } catch (err) {
        console.error("Error calling update extraction API:", err);
      }
    }

    alert(`Specification saved to database (v${updated.version})`);
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
      { 'Attribute': 'Version', 'Value': activeSpec.version.toFixed(1) },
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

    XLSX.writeFile(wb, `${activeSpec.name.replace(/\s+/g, '_')}_v${activeSpec.version.toFixed(1)}.xlsx`);
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

      const response = await fetch('http://localhost:3006/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: columnsPayload,
          joins: joinsPayload,
          limit: 100
        })
      });
      const result = await response.json();

      if (result.success) {
        setPreviewData(result.data);
        setPreviewSql(result.query);
      } else {
        setPreviewSql(result.query || 'Error generating query');
        alert('Extraction Failed: ' + result.message);
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

    try {
      const columnsPayload = spec.columns.map(col => {
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

      const response = await fetch('http://localhost:3006/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: columnsPayload,
          joins: joinsPayload,
          templateFile: spec.backendTemplateName,
          sheetName: spec.sheetName,
          exportFormat: format
        })
      });

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

      if (format === ExportFormat.FBDI) {
        const contentType = response.headers.get('Content-Type');
        if (contentType && contentType.includes('application/json')) {
          // Unexpected JSON response for FBDI request
          const result = await response.json();
          throw new Error(result.message || "Server returned JSON instead of ZIP format");
        }

        const blob = await response.blob();
        if (blob.size < 100) { // Unlikely small for an Archives
          const text = await blob.text();
          if (text.startsWith('{')) {
            const errJson = JSON.parse(text);
            throw new Error(errJson.message || "Invalid file content received");
          }
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fileName = `${spec.name.replace(/\s+/g, '_')}_v${spec.version.toFixed(1)}.zip`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        if (!targetSpec) alert(`Extraction Complete! ZIP package downloaded: ${fileName}`);
        return;
      }

      const result = await response.json();

      if (result.success) {
        if (format === ExportFormat.CSV) {
          const worksheet = XLSX.utils.json_to_sheet(result.data);
          const csv = XLSX.utils.sheet_to_csv(worksheet);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement("a");
          const url = URL.createObjectURL(blob);
          link.setAttribute("href", url);
          const fileName = `${spec.name.replace(/\s+/g, '_')}_v${spec.version.toFixed(1)}.csv`;
          link.setAttribute("download", fileName);
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          if (!targetSpec) alert(`Extraction Complete: ${result.data.length} rows exported to ${fileName}`);
        } else {
          // Fallback or other formats
          alert(`${format.toUpperCase()} export initiated for '${spec.name}'. Implementation pending backend response.`);
        }
      } else {
        alert('Extraction Failed: ' + result.message);
      }
    } catch (e: any) {
      console.error("Extraction failed", e);
      alert("Error: " + e.message);
    } finally {
      setExportLoading(false);
    }
  };

  const handleBatchExtraction = async (format: ExportFormat) => {
    if (!selectedGroup) return;
    // const groupSpecs = specifications.filter(s => s.objectGroupId === selectedGroup.id);
    let groupSpecs = specifications.filter(s => s.objectGroupId === selectedGroup.id);

    // Ignore Instructions sheets natively in Batch Export
    groupSpecs = groupSpecs.filter(s => !s.sheetName.toLowerCase().includes('instruction'));
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
    try {
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

        return {
          sheetName: spec.sheetName,
          columns,
          joins,
          id: spec.id
        };
      });

      const response = await fetch('http://localhost:3006/api/extract-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specs: specsPayload,
          exportFormat: format,
          templateFile: groupSpecs[0]?.backendTemplateName
        })
      });

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
        alert(`Batch extraction complete! Consolidated FBDI workbook downloaded: ${fileName}`);
        return;
      }

      const result = await response.json();
      if (result.success) {
        alert("Batch extraction complete! (Non-FBDI formats currently download individual files if not using consolidation logic)");
      } else {
        alert("Batch extraction failed: " + result.message);
      }
    } catch (e: any) {
      console.error("Batch extraction failed", e);
      alert("Batch extraction error: " + e.message);
    } finally {
      setExportLoading(false);
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
          setSelectedGroup(groups.find(g => g.id === id) || null);
          setActiveSpec(null);
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
                        <span className="text-[10px] bg-purple-100 text-purple-600 px-3 py-1 rounded-full font-black uppercase tracking-widest border border-purple-200">v{activeSpec.version.toFixed(1)}</span>
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
                      <button onClick={handleCloneSpec} className="p-2.5 bg-slate-50 text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-100 transition-all" title="Clone This Specification">
                        <Icons.Upload className="w-5 h-5 rotate-180" />
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
                        onAiSuggest={() => suggestTransformations(col.targetName, col.sourceField, groups).then(sug => updateColumn(col.id, { transformations: sug.map(t => ({ id: `sug_${Date.now()}`, type: t })) }))}
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

    </div >
  );
};

export default App;
