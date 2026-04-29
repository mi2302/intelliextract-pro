import React from 'react';
import { Icons } from '../constants';

interface LoadingScreenProps {
    message?: string;
    progress?: number;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message = "Synchronizing with Database...", progress }) => {
    const hasProgress = typeof progress === 'number';

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#fafafa] overflow-hidden">
            {/* Dynamic Background Effects - Subtle for Fusion */}
            <div className="absolute inset-0 overflow-hidden opacity-10">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#1e709a]/20 blur-[120px] rounded-full animate-pulse"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#1e709a]/20 blur-[120px] rounded-full animate-pulse delay-700"></div>
            </div>

            <div className="relative flex flex-col items-center px-6 text-center max-w-md w-full">
                {/* Premium Spinner/Logo */}
                <div className="relative mb-12 transform hover:scale-105 transition-transform duration-500">
                    <div className="absolute inset-0 bg-[#1e709a]/10 blur-2xl rounded-full scale-150 animate-pulse"></div>
                    <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-tr from-[#1e709a] via-[#165676] to-[#1e709a] p-[2px] shadow-lg shadow-[#1e709a]/10 rotate-12">
                        <div className="w-full h-full bg-white rounded-3xl flex items-center justify-center">
                            <Icons.Database className="w-12 h-12 text-[#1e709a] animate-bounce" />
                        </div>
                    </div>

                    {/* Orbital rings */}
                    <div className="absolute inset-[-20px] border border-[#1e709a]/5 rounded-full animate-[spin_10s_linear_infinite]"></div>
                    <div className="absolute inset-[-40px] border border-[#1e709a]/5 rounded-full animate-[spin_15s_linear_infinite_reverse]"></div>
                </div>

                {/* Text Area */}
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-1000 w-full">
                    <h1 className="text-3xl font-black text-slate-800 tracking-tight uppercase">
                        IntelliExtract <span className="text-[#1e709a]">Pro</span>
                    </h1>

                    <div className="flex flex-col items-center justify-center gap-3">
                        <div className="flex items-center gap-3">
                            <div className="flex gap-1">
                                {[0, 1, 2].map((i) => (
                                    <div
                                        key={i}
                                        className={`w-1.5 h-1.5 rounded-full bg-[#1e709a] animate-bounce`}
                                        style={{ animationDelay: `${i * 0.15}s` }}
                                    />
                                ))}
                            </div>
                            <p className="text-slate-500 font-bold text-[10px] uppercase tracking-[0.2em]">
                                {message}
                            </p>
                        </div>

                        {hasProgress && (
                            <div className="text-[10px] font-black text-[#1e709a] tracking-widest bg-[#1e709a]/5 px-3 py-1 rounded-full border border-[#1e709a]/10">
                                {Math.round(progress)}% COMPLETE
                            </div>
                        )}
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-12 w-full max-w-xs h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    {hasProgress ? (
                        <div
                            className="h-full bg-gradient-to-r from-[#1e709a] to-[#165676] transition-all duration-500 ease-out shadow-[0_0_10px_rgba(30,112,154,0.3)]"
                            style={{ width: `${progress}%` }}
                        ></div>
                    ) : (
                        <div className="h-full bg-gradient-to-r from-[#1e709a] to-[#165676] animate-[loading_2s_ease-in-out_infinite] w-[40%] rounded-full shadow-[0_0_10px_rgba(30,112,154,0.3)]"></div>
                    )}
                </div>
            </div>

            <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); width: 30%; }
          50% { width: 60%; }
          100% { transform: translateX(400%); width: 30%; }
        }
      `}</style>
        </div>
    );
};


export default LoadingScreen;
