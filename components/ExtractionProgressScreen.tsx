
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
        <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
            {/* Background Decorative Elements */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/20 blur-[120px] rounded-full animate-pulse"></div>
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/20 blur-[120px] rounded-full animate-pulse delay-700"></div>

            <div className="relative z-10 max-w-2xl w-full">
                {/* Animated Icon */}
                <div className="mb-12 relative inline-block">
                    <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-20 animate-pulse"></div>
                    <div className="relative bg-gradient-to-br from-blue-500 to-indigo-600 p-8 rounded-3xl shadow-2xl border border-blue-400/30 transform hover:scale-105 transition-transform duration-500">
                        <Icons.Brain className="w-16 h-16 text-white animate-bounce" />
                    </div>
                    {/* Circular Progress Path */}
                    <svg className="absolute -inset-4 w-[calc(100%+32px)] h-[calc(100%+32px)] -rotate-90">
                        <circle
                            cx="50%"
                            cy="50%"
                            r="48%"
                            stroke="currentColor"
                            strokeWidth="2"
                            fill="transparent"
                            className="text-slate-800"
                        />
                        <circle
                            cx="50%"
                            cy="50%"
                            r="48%"
                            stroke="currentColor"
                            strokeWidth="2"
                            fill="transparent"
                            strokeDasharray="301.6"
                            strokeDashoffset={301.6 - (301.6 * progress) / 100}
                            className="text-blue-500 transition-all duration-1000 ease-out"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>

                {/* Content */}
                <h2 className="text-4xl font-black text-white mb-4 tracking-tight leading-tight">
                    Generating Extraction<span className="inline-block w-8 text-left">{dots}</span>
                </h2>
                <p className="text-blue-400 font-bold text-lg mb-8 uppercase tracking-[0.3em]">
                    {specName}
                </p>

                {/* Status Steps */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-3xl p-8 mb-10 shadow-2xl backdrop-blur-md">
                    <div className="flex items-center justify-between mb-6">
                        <span className="text-slate-400 text-xs font-black uppercase tracking-widest">Current Status</span>
                        <span className="text-blue-400 font-mono font-bold text-xl">{Math.round(progress)}%</span>
                    </div>

                    <div className="h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-700 mb-8 p-1">
                        <div
                            className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-400 rounded-full transition-all duration-700 ease-out relative"
                            style={{ width: `${progress}%` }}
                        >
                            <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                        </div>
                    </div>

                    <p className="text-slate-100 text-lg font-medium italic">
                        "{status}"
                    </p>
                </div>

                {/* Footer Info */}
                <div className="flex items-center justify-center gap-8 text-slate-500">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                        <span className="text-[10px] font-bold uppercase tracking-widest">Secure Oracle Connection</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse delay-300"></div>
                        <span className="text-[10px] font-bold uppercase tracking-widest">AI Mapping active</span>
                    </div>
                </div>

                {onCancel && progress < 100 && (
                    <button
                        onClick={onCancel}
                        className="mt-12 text-slate-500 hover:text-red-400 text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2 mx-auto"
                    >
                        <Icons.Plus className="w-4 h-4 rotate-45" /> Cancel Extraction
                    </button>
                )}
            </div>
        </div>
    );
};

export default ExtractionProgressScreen;
