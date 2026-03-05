
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
  steps, onAddStep, onRemoveStep, onUpdateStep, onAiSuggest 
}) => {
  const [isSuggesting, setIsSuggesting] = useState(false);

  const handleSuggest = async () => {
    setIsSuggesting(true);
    await onAiSuggest();
    setIsSuggesting(false);
  };

  return (
    <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-dashed border-slate-300">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase">Transformation Pipeline</span>
            <button 
                onClick={handleSuggest}
                disabled={isSuggesting}
                className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold border border-blue-200 hover:bg-blue-100 transition-all disabled:opacity-50"
            >
                <Icons.Brain className={`w-3 h-3 ${isSuggesting ? 'animate-spin' : ''}`} />
                {isSuggesting ? 'Thinking...' : 'AI Suggest Steps'}
            </button>
        </div>
        <button 
          onClick={() => onAddStep()}
          className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded flex items-center gap-1"
        >
          <Icons.Plus className="w-3 h-3" /> Add Step
        </button>
      </div>

      <div className="space-y-3">
        {steps.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-4">No transformations applied. Data will flow as-is.</div>
        )}
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-3">
            <div className="text-[10px] font-bold text-slate-400 w-4">{index + 1}</div>
            <select
              value={step.type}
              onChange={(e) => onUpdateStep(step.id, { type: e.target.value as TransformationType })}
              className="flex-1 bg-white border border-slate-200 text-xs p-1.5 rounded outline-none focus:ring-1 focus:ring-blue-500"
            >
              {Object.values(TransformationType).map(t => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
            
            {step.type === TransformationType.AI_SUMMARY && (
                <input 
                    type="text" 
                    placeholder="AI Prompt..." 
                    className="flex-[2] bg-white border border-slate-200 text-xs p-1.5 rounded"
                    value={step.params?.prompt || ''}
                    onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, prompt: e.target.value }})}
                />
            )}

            {step.type === TransformationType.REGEX_REPLACE && (
                <div className="flex flex-[2] gap-1">
                    <input 
                        type="text" 
                        placeholder="Pattern" 
                        className="w-1/2 bg-white border border-slate-200 text-xs p-1.5 rounded"
                        value={step.params?.pattern || ''}
                        onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, pattern: e.target.value }})}
                    />
                    <input 
                        type="text" 
                        placeholder="Replace" 
                        className="w-1/2 bg-white border border-slate-200 text-xs p-1.5 rounded"
                        value={step.params?.replace || ''}
                        onChange={(e) => onUpdateStep(step.id, { params: { ...step.params, replace: e.target.value }})}
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
