import React from 'react';
import { Icons } from '../constants';

interface LoadingScreenProps {
    message?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message = "Synchronizing with Database..." }) => {
    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-950 overflow-hidden">
            {/* Dynamic Background Effects */}
            <div className="absolute inset-0 overflow-hidden opacity-30">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full animate-pulse"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full animate-pulse delay-700"></div>
            </div>

            <div className="relative flex flex-col items-center px-6 text-center max-w-md">
                {/* Premium Spinner/Logo */}
                <div className="relative mb-12 transform hover:scale-105 transition-transform duration-500">
                    <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full scale-150 animate-pulse"></div>
                    <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-[2px] shadow-2xl shadow-blue-500/20 rotate-12">
                        <div className="w-full h-full bg-slate-900 rounded-3xl flex items-center justify-center">
                            <Icons.Database className="w-12 h-12 text-white animate-bounce" />
                        </div>
                    </div>

                    {/* Orbital rings */}
                    <div className="absolute inset-[-20px] border border-white/5 rounded-full animate-[spin_10s_linear_infinite]"></div>
                    <div className="absolute inset-[-40px] border border-white/5 rounded-full animate-[spin_15s_linear_infinite_reverse]"></div>
                </div>

                {/* Text Area */}
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                    <h1 className="text-3xl font-black text-white tracking-tight uppercase">
                        IntelliExtract <span className="text-blue-500">Pro</span>
                    </h1>

                    <div className="flex items-center justify-center gap-3">
                        <div className="flex gap-1">
                            {[0, 1, 2].map((i) => (
                                <div
                                    key={i}
                                    className={`w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce`}
                                    style={{ animationDelay: `${i * 0.15}s` }}
                                />
                            ))}
                        </div>
                        <p className="text-slate-400 font-bold text-sm uppercase tracking-[0.2em]">
                            {message}
                        </p>
                    </div>
                </div>

                {/* Progress Bar (Visual Only) */}
                <div className="mt-12 w-64 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                    <div className="h-full bg-gradient-to-r from-blue-600 to-purple-600 animate-[loading_2s_ease-in-out_infinite] w-[40%] rounded-full shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
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
