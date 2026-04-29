
import React, { useState } from 'react';
import { TransformationStep, TransformationType } from '../types';
import { Icons } from '../constants';

interface TransformationPipelineProps {
  steps: TransformationStep[];
  onAddStep: (type?: TransformationType) => void;
  onRemoveStep: (id: string) => void;
  onUpdateStep: (id: string, updates: Partial<TransformationStep>) => void;
  onAiSuggest: () => void;
}

const TransformationPipeline: React.FC<TransformationPipelineProps> = ({
  steps = [], onAddStep, onRemoveStep, onUpdateStep, onAiSuggest
}) => {
  const [isSuggesting, setIsSuggesting] = useState(false);

  const handleSuggest = async () => {
    setIsSuggesting(true);
    await onAiSuggest();
    setIsSuggesting(false);
  };

  if (!steps) return null;

  return (
    <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Transformation Pipeline</span>
          <button
            onClick={handleSuggest}
            disabled={isSuggesting}
            className="flex items-center gap-1.5 px-2 py-0.5 bg-[#e5f1f8] text-[#1e709a] rounded-md text-[10px] font-bold border border-[#1e709a]/10 hover:bg-[#1e709a]/10 transition-all disabled:opacity-50"
          >
            <Icons.Brain className={`w-3 h-3 ${isSuggesting ? 'animate-spin' : ''}`} />
            {isSuggesting ? 'Thinking...' : 'AI Suggest Steps'}
          </button>
        </div>
        <button
          onClick={() => onAddStep()}
          className="text-[10px] bg-white border border-slate-200 font-bold uppercase tracking-wide hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-md flex items-center gap-1 transition-colors"
        >
          <Icons.Plus className="w-3 h-3" /> Add Step
        </button>
      </div>

      <div className="space-y-3">
        {(steps || []).length === 0 && (
          <div className="text-xs text-slate-400 text-center py-4">No transformations applied. Data will flow as-is.</div>
        )}
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-3">
            <div className="text-[10px] font-bold text-slate-400 w-4">{index + 1}</div>
            <select
              value={step.type}
              onChange={(e) => onUpdateStep(step.id, { type: e.target.value as TransformationType })}
              className="flex-1 bg-white border border-slate-200 text-xs p-1.5 rounded-md outline-none focus:ring-1 focus:ring-[#1e709a]/30"
            >
              {Object.values(TransformationType).map(t => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>

            {step.type === TransformationType.AI_SUMMARY && (
              <input
                type="text"
                placeholder="AI Prompt..."
                className="flex-[2] bg-white border border-slate-200 text-xs p-1.5 rounded-md outline-none focus:ring-1 focus:ring-[#1e709a]/30"
                value={step.params?.prompt || ''}
                onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, prompt: e.target.value } })}
              />
            )}

            {step.type === TransformationType.DATE_FORMAT && (
              <input
                type="text"
                placeholder="Format (e.g. YYYY/MM/DD)"
                className="flex-[2] bg-white border border-slate-200 text-xs p-1.5 rounded-md outline-none focus:ring-1 focus:ring-[#1e709a]/30"
                value={step.params?.format || ''}
                onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, format: e.target.value } })}
              />
            )}

            {step.type === TransformationType.SUBSTRING && (
              <div className="flex flex-[2] gap-1">
                <input
                  type="text"
                  placeholder="Start"
                  className="w-1/2 bg-white border border-slate-200 text-xs p-1.5 rounded"
                  value={step.params?.start || ''}
                  onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, start: e.target.value } })}
                />
                <input
                  type="text"
                  placeholder="Length"
                  className="w-1/2 bg-white border border-slate-200 text-xs p-1.5 rounded"
                  value={step.params?.length || ''}
                  onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, length: e.target.value } })}
                />
              </div>
            )}

            {step.type === TransformationType.MULTIPLY && (
              <input
                type="text"
                placeholder="Factor (e.g. 1.1)"
                className="flex-[2] bg-white border border-slate-200 text-xs p-1.5 rounded"
                value={step.params?.factor || ''}
                onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, factor: e.target.value } })}
              />
            )}

            {step.type === TransformationType.COALESCE && (
              <input
                type="text"
                placeholder="Default Value"
                className="flex-[2] bg-white border border-slate-200 text-xs p-1.5 rounded"
                value={step.params?.defaultValue || ''}
                onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, defaultValue: e.target.value } })}
              />
            )}

            {step.type === TransformationType.REGEX_REPLACE && (
              <div className="flex flex-[2] gap-1">
                <input
                  type="text"
                  placeholder="Pattern"
                  className="w-1/2 bg-white border border-slate-200 text-xs p-1.5 rounded"
                  value={step.params?.pattern || ''}
                  onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, pattern: e.target.value } })}
                />
                <input
                  type="text"
                  placeholder="Replace"
                  className="w-1/2 bg-white border border-slate-200 text-xs p-1.5 rounded"
                  value={step.params?.replace || ''}
                  onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, replace: e.target.value } })}
                />
              </div>
            )}

            <button
              onClick={() => onRemoveStep(step.id)}
              className="p-1.5 text-slate-400 hover:text-red-500"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TransformationPipeline;
