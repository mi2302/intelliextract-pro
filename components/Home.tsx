import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons } from '../constants';

const Home: React.FC = () => {
    const navigate = useNavigate();

    const services = [
        {
            id: 'fbdi',
            title: 'FBDI Service',
            description: 'File Based Data Import service for Oracle Fusion Applications.',
            icon: <Icons.Upload className="w-8 h-8 text-blue-600" />,
            action: () => navigate('/fbdi'),
            comingSoon: false,
        },
        {
            id: 'rest',
            title: 'REST Service',
            description: 'Automated REST API integration for enterprise data exchange.',
            icon: <Icons.Search className="w-8 h-8 text-blue-600" />,
            action: () => { },
            comingSoon: true,
        },
        {
            id: 'hdl',
            title: 'HDL Service',
            description: 'HCM Data Loader for high-volume data exchange.',
            icon: <Icons.Database className="w-8 h-8 text-blue-600" />,
            action: () => { },
            comingSoon: true,
        },
        {
            id: 'soap',
            title: 'SOAP Service',
            description: 'Legacy SOAP web services integration and automation.',
            icon: <Icons.Settings className="w-8 h-8 text-blue-600" />,
            action: () => { },
            comingSoon: true,
        },
    ];

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#fafafa] flex flex-col items-center justify-center min-h-screen w-full">

            <div className="w-full max-w-full px-4 md:px-12 lg:px-24 mx-auto space-y-16 py-12 flex-1 flex flex-col justify-center">
                {/* Header Section */}
                <div className="text-center space-y-6 max-w-4xl mx-auto">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-slate-200 text-[#1e709a] text-[10px] font-black uppercase tracking-widest mb-2 shadow-sm">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1e709a]"></span>
                        </span>
                        Enterprise Data Bridge
                    </div>
                    <h1 className="text-5xl font-black text-slate-800 tracking-tighter sm:text-5xl uppercase">
                        {/* Enterprise <span className="text-[#1e709a]">Sync</span> Engine */}
                        Enterprise Sync Engine
                    </h1>
                    <p className="text-lg text-slate-500 font-medium max-w-2xl mx-auto leading-relaxed">
                        The ultimate integration hub for enterprise data exchange.
                        Unified automation for <strong>FBDI</strong>, <strong>REST</strong>, and legacy enterprise systems.
                    </p>
                </div>

                {/* Services Section */}
                <div className="space-y-8">
                    <div className="flex items-center justify-center">
                        <div className="h-[1px] bg-slate-200 flex-1"></div>
                        <div className="mx-8 bg-slate-50 px-6 py-2 rounded-full border border-slate-200 shadow-sm flex items-center gap-3">
                            <Icons.Brain className="w-4 h-4 text-[#1e709a]" />
                            <span className="text-[10px] text-slate-400 font-black uppercase tracking-[0.3em]">Module Registry</span>
                        </div>
                        <div className="h-[1px] bg-slate-200 flex-1"></div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {services.map((service) => (
                            <div
                                key={service.id}
                                onClick={!service.comingSoon ? service.action : undefined}
                                className={`group bg-white p-8 rounded-xl shadow-sm border border-slate-200 transition-all duration-300 relative overflow-hidden ${!service.comingSoon
                                    ? 'cursor-pointer hover:shadow-xl hover:border-[#1e709a]/50 hover:-translate-y-1'
                                    : 'opacity-50 grayscale cursor-not-allowed'
                                    }`}
                            >
                                <div className={`absolute top-0 right-0 w-24 h-24 -mr-12 -mt-12 rounded-full transition-all duration-700 opacity-0 group-hover:opacity-5 ${!service.comingSoon ? 'bg-[#1e709a]' : 'bg-slate-400'}`}></div>

                                <div className="space-y-6 relative">
                                    <div className="w-14 h-14 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-100 transition-all duration-500 shadow-sm text-[#1e709a] group-hover:bg-[#1e709a] group-hover:text-white group-hover:scale-110">
                                        {React.cloneElement(service.icon as React.ReactElement<{ className?: string }>, { className: 'w-6 h-6' })}
                                    </div>

                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className={`text-lg font-black tracking-tight transition-colors uppercase ${!service.comingSoon ? 'text-slate-800' : 'text-slate-400'}`}>{service.title}</h3>
                                        </div>
                                        <p className="text-xs text-slate-500 leading-relaxed font-bold">
                                            {service.description}
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-between pt-4">
                                        {!service.comingSoon ? (
                                            <div className="flex items-center gap-2 text-[#1e709a] font-black text-[10px] uppercase tracking-[0.2em] group-hover:gap-4 transition-all">
                                                Initialize Module
                                                <Icons.Play className="w-2.5 h-2.5" />
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 text-slate-300 font-black text-[9px] uppercase tracking-widest">
                                                Locked / Roadmap
                                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Home;
