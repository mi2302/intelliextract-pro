import React, { useState, useRef, useEffect } from 'react';
import { Icons } from '../constants';

interface Option {
    value: string;
    label: string;
    group?: string;
    type?: string;
}

interface SearchableSelectProps {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
    options,
    value,
    onChange,
    placeholder = "Select...",
    className
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    // Find selected label
    const selectedOption = options.find(o => o.value === value);

    // Filter options
    const filteredOptions = options.filter(option => {
        const search = searchTerm.toLowerCase();
        return (
            option.label.toLowerCase().includes(search) ||
            (option.group && option.group.toLowerCase().includes(search))
        );
    });

    // Group by group
    const groupedOptions = filteredOptions.reduce((acc, option) => {
        const group = option.group || 'Other';
        if (!acc[group]) acc[group] = [];
        acc[group].push(option);
        return acc;
    }, {} as Record<string, Option[]>);

    const handleSelect = (val: string) => {
        onChange(val);
        setIsOpen(false);
        setSearchTerm('');
    };

    return (
        <div className={`relative ${className}`} ref={wrapperRef}>
            <div
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-purple-500 transition-all cursor-pointer flex justify-between items-center hover:border-purple-300"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={selectedOption ? "text-slate-800" : "text-slate-400"}>
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <Icons.Plus className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-45" : ""}`} />
            </div>

            {isOpen && (
                <div className="absolute z-50 top-full left-0 w-full mt-2 bg-white rounded-xl shadow-xl border border-slate-100 max-h-60 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 origin-top">
                    <div className="p-2 border-b border-slate-100 bg-slate-50 sticky top-0">
                        <input
                            autoFocus
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium outline-none focus:border-purple-500"
                            placeholder="Search field..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                    <div className="overflow-y-auto p-1 custom-scrollbar flex-1">
                        {Object.entries(groupedOptions).length === 0 && (
                            <div className="p-4 text-center text-xs text-slate-400">No matches found</div>
                        )}
                        {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
                            <div key={groupName} className="mb-2">
                                <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest sticky top-0 bg-white/95 backdrop-blur-sm">
                                    {groupName}
                                </div>
                                {groupOptions.map(opt => (
                                    <div
                                        key={opt.value}
                                        className={`px-3 py-2 text-xs rounded-lg cursor-pointer flex justify-between items-center transition-colors ${value === opt.value ? 'bg-purple-50 text-purple-700 font-bold' : 'hover:bg-slate-50 text-slate-600'}`}
                                        onClick={() => handleSelect(opt.value)}
                                    >
                                        <span>{opt.label.split('(')[0]}</span>
                                        {opt.type && <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-400 font-mono">{opt.type}</span>}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
