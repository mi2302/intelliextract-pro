
import React, { useEffect, useState } from 'react';
import { Icons } from '../constants';

interface ExtractionProgressScreenProps {
    specName: string;
    progress: number;
    status: string;
    onCancel?: () => void;
}

const ExtractionProgressScreen: React.FC<ExtractionProgressScreenProps> = ({
    specName,
    progress,
    status,
    onCancel
}) => {
    const [dots, setDots] = useState('');

    useEffect(() => {
        const interval = setInterval(() => {
            setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
        }, 500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="fixed inset-0 z-[100] bg-[#fafafa] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
            {/* Background Decorative Elements - Subtle for Fusion */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#1e709a]/5 blur-[120px] rounded-full animate-pulse"></div>
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#1e709a]/5 blur-[120px] rounded-full animate-pulse delay-700"></div>

            <div className="relative z-10 max-w-2xl w-full">
                {/* Animated Icon */}
                <div className="mb-10 relative inline-block">
                    <div className="absolute inset-0 bg-[#1e709a]/10 blur-2xl opacity-20 animate-pulse"></div>
                    <div className="relative bg-[#1e709a] p-8 rounded-3xl shadow-xl border border-[#1e709a]/20 transform hover:scale-105 transition-transform duration-500">
                        <Icons.Brain className="w-16 h-16 text-white animate-bounce" />
                    </div>
                </div>

                {/* Content */}
                <h2 className="text-3xl font-bold text-slate-800 mb-4 tracking-tight leading-tight">
                    Generating Extraction<span className="inline-block w-8 text-left">{dots}</span>
                </h2>
                <p className="text-[#1e709a] font-bold text-lg mb-8 uppercase tracking-[0.2em]">
                    {specName}
                </p>

                {/* Status Card - Fusion Style */}
                <div className="bg-white border border-slate-200 rounded-2xl p-8 mb-10 shadow-sm backdrop-blur-md">
                    <div className="flex items-center justify-between mb-6">
                        <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Extraction Progress</span>
                        <span className="text-[#1e709a] font-mono font-bold text-xl">{Math.round(progress)}%</span>
                    </div>

                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200 mb-8">
                        <div
                            className="h-full bg-[#1e709a] transition-all duration-700 ease-out relative"
                            style={{ width: `${progress}%` }}
                        >
                            <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                        </div>
                    </div>

                    <p className="text-slate-600 text-lg font-medium italic">
                        "{status}"
                    </p>
                </div>

                {/* Footer Info */}
                <div className="flex items-center justify-center gap-8 text-slate-400">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                        <span className="text-[9px] font-bold uppercase tracking-widest">Connected to Oracle ATP</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#1e709a] animate-pulse delay-300"></div>
                        <span className="text-[9px] font-bold uppercase tracking-widest">Metadata Mapping...</span>
                    </div>
                </div>

                {onCancel && progress < 100 && (
                    <button
                        onClick={onCancel}
                        className="mt-12 text-slate-400 hover:text-red-500 text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-2 mx-auto"
                    >
                        <Icons.Plus className="w-4 h-4 rotate-45" /> Cancel Extraction
                    </button>
                )}
            </div>
        </div>
    );

};

export default ExtractionProgressScreen;
