
import React, { useState } from 'react';
import { ObjectGroup, ObjectRelationship, DataObject, DataField, FileSpecification, ExportFormat } from '../types';
import { Icons } from '../constants';

interface DataModelViewProps {
  group: ObjectGroup;
  specifications: FileSpecification[];
  onUpdateGroup: (group: ObjectGroup) => void;
  onSelectSpec: (spec: FileSpecification) => void;
  onCreateSpec: () => void;
  onDeleteSpec: (id: string) => void;
  onRunExtraction: (format: ExportFormat) => void;
  onSaveArchitecture?: () => void;
}

const DataModelView: React.FC<DataModelViewProps> = ({
  group,
  specifications,
  onUpdateGroup,
  onSelectSpec,
  onCreateSpec,
  onDeleteSpec,
  onRunExtraction,
  onSaveArchitecture
}) => {
  const [editingRelIdx, setEditingRelIdx] = useState<number | null>(null);
  const [isAddingRel, setIsAddingRel] = useState(false);
  const [fieldSearches, setFieldSearches] = useState<Record<string, string>>({});
  const [sourceField, setSourceField] = useState('');
  const [targetField, setTargetField] = useState('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  const initialSourceId = group.objects?.[0]?.id || '';
  const initialTargetId = group.objects?.[1]?.id || group.objects?.[0]?.id || '';

  const [activeRel, setActiveRel] = useState<ObjectRelationship>({
    sourceObjectId: initialSourceId,
    targetObjectId: initialTargetId,
    joinType: 'INNER',
    condition: ''
  });

  const updateRelCondition = (srcObjId: string, srcFld: string, trgObjId: string, trgFld: string) => {
    const srcObj = group.objects?.find(o => o.id === srcObjId);
    const trgObj = group.objects?.find(o => o.id === trgObjId);
    if (srcObj && trgObj && srcFld && trgFld) {
      return `${srcObj.tableName}.${srcFld} = ${trgObj.tableName}.${trgFld}`;
    }
    return '';
  };

  const handleSaveRel = () => {
    const condition = updateRelCondition(activeRel.sourceObjectId, sourceField, activeRel.targetObjectId, targetField);
    const relWithCondition = { ...activeRel, condition };
    const updatedRels = [...(group.relationships || [])];
    if (editingRelIdx !== null) updatedRels[editingRelIdx] = relWithCondition;
    else updatedRels.push(relWithCondition);
    onUpdateGroup({ ...group, relationships: updatedRels });
    setIsAddingRel(false);
    setEditingRelIdx(null);
  };

  const deleteRel = (idx: number) => {
    onUpdateGroup({ ...group, relationships: (group.relationships || []).filter((_, i) => i !== idx) });
  };

  const addEntity = () => {
    const defaultTableName = `NEW_TABLE_${Date.now()}`;
    const newObj: DataObject = {
      id: defaultTableName,
      name: 'New Entity',
      tableName: defaultTableName,
      fields: [{ name: 'ID', type: 'NUMBER', description: 'Primary Key' }]
    };
    onUpdateGroup({ ...group, objects: [...(group.objects || []), newObj] });
  };

  const updateFieldType = (objId: string, fieldName: string, newType: DataField['type']) => {
    onUpdateGroup({
      ...group,
      objects: (group.objects || []).map(o => o.id === objId ? {
        ...o,
        fields: (o.fields || []).map(f => f.name === fieldName ? { ...f, type: newType } : f)
      } : o)
    });
  };

  const addField = (objId: string, name: string) => {
    if (!name.trim()) return;
    const newF: DataField = { name: name.toUpperCase(), type: 'STRING', description: '' };
    onUpdateGroup({
      ...group,
      objects: (group.objects || []).map(o => o.id === objId ? { ...o, fields: [...(o.fields || []), newF] } : o)
    });
  };

  const deleteField = (objId: string, fieldName: string) => {
    onUpdateGroup({
      ...group,
      objects: (group.objects || []).map(o => o.id === objId ? { ...o, fields: (o.fields || []).filter(f => f.name !== fieldName) } : o)
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Source Architecture & Relationships Section */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              <Icons.Database className="w-6 h-6 text-blue-600" />
              Source Architecture
            </h3>
            <p className="text-slate-400 text-sm mt-1">Design entities, data types, and logical joins for this master data group.</p>
          </div>
          <div className="flex gap-3">
            {onSaveArchitecture && (
              <button onClick={onSaveArchitecture} className="t-Button flex items-center gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                <Icons.File className="w-4 h-4" /> Save Entities
              </button>
            )}
            <button onClick={addEntity} className="t-Button flex items-center gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
              <Icons.Plus className="w-4 h-4" /> Add Entity
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {(group.objects || []).map((obj) => {
            const searchTerm = (fieldSearches[obj.id] || '').toLowerCase();
            const filteredFields = (obj.fields || []).filter(f => f.name.toLowerCase().includes(searchTerm) || f.type.toLowerCase().includes(searchTerm));
            return (
              <div key={obj.id} className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50 transition-all hover:border-blue-300 group flex flex-col h-[400px]">
                <div className="bg-slate-100 p-4 border-b border-slate-200 flex justify-between items-center group-hover:bg-blue-50 transition-colors shrink-0">
                  <div className="flex-1 overflow-hidden">
                    <input className="font-bold text-slate-700 bg-transparent border-none outline-none focus:ring-0 w-full truncate" value={obj.name} onChange={(e) => onUpdateGroup({ ...group, objects: group.objects.map(o => o.id === obj.id ? { ...o, name: e.target.value } : o) })} />
                    <div className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">{obj.tableName}</div>
                  </div>
                  <button onClick={() => onUpdateGroup({ ...group, objects: group.objects.filter(o => o.id !== obj.id) })} className="text-slate-300 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                    <Icons.Plus className="w-4 h-4 rotate-45" />
                  </button>
                </div>

                <div className="px-3 py-2 bg-white border-b border-slate-100 shrink-0">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search attributes/types..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-400"
                      value={fieldSearches[obj.id] || ''}
                      onChange={(e) => setFieldSearches(prev => ({ ...prev, [obj.id]: e.target.value }))}
                    />
                    <div className="absolute left-2.5 top-2 text-slate-400">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar bg-white">
                  {filteredFields.length > 0 ? (
                    filteredFields.map((field) => (
                      <div key={field.name} className="flex justify-between items-center text-xs p-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 group/field">
                        <span className="text-slate-700 font-mono font-bold truncate max-w-[50%]" title={field.name}>{field.name}</span>
                        <div className="flex items-center gap-2">
                          <select
                            className="bg-blue-50 text-blue-600 font-bold text-[9px] uppercase border-none rounded-md px-1 py-0.5 outline-none cursor-pointer"
                            value={field.type}
                            onChange={(e) => updateFieldType(obj.id, field.name, e.target.value as any)}
                          >
                            <option value="STRING">STRING</option>
                            <option value="NUMBER">NUMBER</option>
                            <option value="DATE">DATE</option>
                            <option value="BOOLEAN">BOOL</option>
                          </select>
                          <button onClick={() => deleteField(obj.id, field.name)} className="text-slate-200 hover:text-red-400 opacity-0 group-field/field:opacity-100 p-0.5">
                            <Icons.Plus className="w-3.5 h-3.5 rotate-45" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 text-[10px] p-6 text-center">No results.</div>
                  )}
                </div>

                <div className="p-3 bg-slate-50 border-t border-slate-200 shrink-0">
                  <input
                    placeholder="+ Add attribute..."
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                    onKeyDown={(e) => { if (e.key === 'Enter') { addField(obj.id, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-10 border-t border-slate-100">
          <div className="flex items-center justify-between mb-8">
            <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <Icons.Settings className="w-5 h-5 text-blue-600" />
              Relationship Architect
            </h4>
            <div className="flex gap-3">
              {onSaveArchitecture && (
                <button onClick={onSaveArchitecture} className="t-Button flex items-center gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                  <Icons.File className="w-4 h-4" /> Save Joins
                </button>
              )}
              <button onClick={() => setIsAddingRel(true)} className="t-Button t-Button--primary flex items-center gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                <Icons.Plus className="w-4 h-4" /> Establish Connection
              </button>
            </div>
          </div>

          {(isAddingRel || editingRelIdx !== null) && (
            <div className="mb-8 p-6 bg-blue-50 rounded-2xl border border-blue-200 animate-in slide-in-from-top-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Source</label>
                  <select className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm mb-2" value={activeRel.sourceObjectId} onChange={(e) => { setActiveRel({ ...activeRel, sourceObjectId: e.target.value }); setSourceField(''); }}>
                    <option value="">Select Object...</option>
                    {group.objects?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <select className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm" value={sourceField} onChange={(e) => setSourceField(e.target.value)}>
                    <option value="">Select Field...</option>
                    {group.objects?.find(o => o.id === activeRel.sourceObjectId)?.fields?.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col items-center justify-center pt-6">
                  <select className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold text-blue-600 mb-2" value={activeRel.joinType} onChange={(e) => setActiveRel({ ...activeRel, joinType: e.target.value as any })}>
                    <option value="INNER">INNER JOIN</option>
                    <option value="LEFT">LEFT JOIN</option>
                  </select>
                  <div className="w-full h-px bg-blue-200 relative"><div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-500 text-white p-1 rounded-full"><Icons.Play className="w-3 h-3" /></div></div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Target</label>
                  <select className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm mb-2" value={activeRel.targetObjectId} onChange={(e) => { setActiveRel({ ...activeRel, targetObjectId: e.target.value }); setTargetField(''); }}>
                    <option value="">Select Object...</option>
                    {group.objects?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <select className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm" value={targetField} onChange={(e) => setTargetField(e.target.value)}>
                    <option value="">Select Field...</option>
                    {group.objects?.find(o => o.id === activeRel.targetObjectId)?.fields?.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-between items-center bg-white/50 p-4 rounded-xl border border-blue-100">
                <div className="text-xs text-slate-500 font-mono">Generated: <span className="text-blue-600 font-bold">{updateRelCondition(activeRel.sourceObjectId, sourceField, activeRel.targetObjectId, targetField) || '... awaiting fields'}</span></div>
                <div className="flex gap-3">
                  <button onClick={() => { setIsAddingRel(false); setEditingRelIdx(null); }} className="px-4 py-2 text-sm font-bold text-slate-500">Cancel</button>
                  <button onClick={handleSaveRel} disabled={!sourceField || !targetField} className="t-Button t-Button--primary disabled:opacity-50">Save Join</button>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(group.relationships || []).map((rel, idx) => {
              const src = group.objects?.find(o => o.id === rel.sourceObjectId);
              const trg = group.objects?.find(o => o.id === rel.targetObjectId);
              return (
                <div key={idx} className="group relative flex flex-col gap-2 bg-slate-50 p-5 rounded-2xl border border-slate-200 hover:border-blue-300 transition-all hover:bg-white hover:shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded shadow-sm border ${rel.joinType === 'INNER' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>{rel.joinType}</span>
                    <button onClick={() => deleteRel(idx)} className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-red-500 transition-all"><Icons.Plus className="w-4 h-4 rotate-45" /></button>
                  </div>
                  <div className="flex items-center gap-3 text-sm font-bold text-slate-700">
                    {src?.name} <Icons.Play className="w-3 h-3 text-slate-300" /> {trg?.name}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 bg-white p-2.5 rounded-lg border border-slate-100 truncate shadow-inner">{rel.condition}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Active Extractions Dashboard - List View moved to bottom */}
      <div className="bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-2xl overflow-hidden relative pb-12">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 blur-[100px] rounded-full -mr-32 -mt-32"></div>
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-3">
                <Icons.File className="w-5 h-5 text-blue-400" />
                Extractions for {group.name}
              </h3>
              <p className="text-slate-400 text-xs mt-1">Manage multiple output variants, versions, and configurations for this data model.</p>
            </div>
            <div className="flex gap-3">
              <div className="relative">
                <button
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  className="t-Button t-Button--primary flex items-center gap-2"
                >
                  <Icons.Play className="w-4 h-4" /> Run Extraction
                  <Icons.Plus className={`w-3 h-3 transition-transform ${isExportMenuOpen ? 'rotate-45' : ''}`} />
                </button>

                {isExportMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-1.5 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50 mb-1">
                      Select Export Format
                    </div>
                    {[ExportFormat.CSV, ExportFormat.FBDI, ExportFormat.REST, ExportFormat.SOAP].map((format) => (
                      <button
                        key={format}
                        onClick={() => {
                          onRunExtraction(format);
                          setIsExportMenuOpen(false);
                        }}
                        className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors uppercase flex items-center justify-between group"
                      >
                        {format}
                        <Icons.Download className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-400 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={onCreateSpec}
                className="t-Button t-Button--primary flex items-center gap-2"
              >
                <Icons.Plus className="w-4 h-4" /> Create New Extraction
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {specifications.length === 0 ? (
              <div className="py-12 border-2 border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center text-slate-500">
                <p className="text-sm font-medium">No extractions defined yet for this model.</p>
                <button onClick={onCreateSpec} className="mt-2 text-blue-400 text-xs font-bold hover:underline">Start mapping now</button>
              </div>
            ) : (
              <div className="bg-slate-950/40 rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/50">
                {specifications.map((spec) => (
                  <div
                    key={spec.id}
                    className="group flex items-center gap-6 px-6 py-4 hover:bg-slate-800/60 transition-all cursor-pointer"
                    onClick={() => onSelectSpec(spec)}
                  >
                    {/* Left: Icon & Title */}
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="bg-slate-800 p-2.5 rounded-xl border border-slate-700/50 group-hover:border-blue-500/50 group-hover:bg-blue-600/10 transition-all">
                        <Icons.File className="w-5 h-5 text-slate-400 group-hover:text-blue-400" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-100 truncate group-hover:text-white transition-colors">
                            {spec.name}
                          </h4>
                          <span className="shrink-0 text-[10px] bg-slate-800 text-blue-400 px-2 py-0.5 rounded-md font-black border border-slate-700">
                            v{Number(spec.version).toFixed(1)}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono mt-0.5">Created {new Date(spec.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    {/* Middle: Metadata */}
                    <div className="hidden sm:flex items-center gap-8 px-4 border-l border-slate-800/50">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-slate-500 uppercase font-black tracking-widest mb-0.5">Format</span>
                        <span className="text-xs font-bold text-slate-300 uppercase">{spec.format}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[9px] text-slate-500 uppercase font-black tracking-widest mb-0.5">Fields</span>
                        <span className="text-xs font-bold text-slate-300">{spec.columns.length} Total</span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteSpec(spec.id); }}
                        className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                        title="Delete Specification"
                      >
                        <Icons.Plus className="w-4 h-4 rotate-45" />
                      </button>
                      <div className="p-2 text-slate-600 group-hover:text-blue-400 transition-all">
                        <Icons.Play className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataModelView;
