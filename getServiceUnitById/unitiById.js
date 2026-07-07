if (!_input || !_input.unitId) {
    throw new Error("Parâmetro 'unitId' é obrigatório.");
}

try {
    const BASE_URL = "https://wevets-dev.sydle.one/";

    const unit = crm.ServiceUnit._get({ "_id": _input.unitId });

    if (!unit) {
        throw new Error(`Unidade com o ID ${_input.unitId} não foi encontrada.`);
    }

    const additionalData = unit.additionalData?.[0] || {};
    const address = unit.address || {};

    const coord = address.coordinates || null;
    const lat = coord ? coord.lat : null;
    const lng = coord ? coord.lon : null;

    const logo = unit.photo
        ? `${BASE_URL}api/1/main/crm/ServiceUnit/_extGetPhotoLink/${unit._id}`
        : null;

    const currentDate = new Date();
    const weekdayList = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
    const currentWeekday = weekdayList[currentDate.getDay()];
    const hours = String(currentDate.getHours()).padStart(2, '0');
    const minutes = String(currentDate.getMinutes()).padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;

    const businessHoursList = additionalData.businessHours || [];
    let openingStatus = "CLOSED";

    if (additionalData.active) {
        const todayCalculation = businessHoursList.find(
            bh => bh.day === currentWeekday
        );

        if (todayCalculation && todayCalculation.open) {
            const { openingTime, closingTime } = todayCalculation;

            if (!openingTime && !closingTime) {
                openingStatus = "OPEN_24";
            } else if (
                openingTime === "00:00" &&
                closingTime === "00:00"
            ) {
                openingStatus = "OPEN_24";
            } else if (
                openingTime &&
                closingTime &&
                currentTime >= openingTime &&
                currentTime < closingTime
            ) {
                openingStatus = "OPEN";
            }
        }
    }

    // --- Planos
    const PLAN_GROUPS_MAP = {
        "básico": ["básico"],
        "start": ["start"],
        "rotina": ["rotina"],
        "conforto": ["conforto"],
        "plus": ["plus"],
        "super": ["super"],
        "ultra": ["ultra"],
        "premium": ["premium"],
        "cw": ["cw1", "cw2"],
        "master": ["master"],
        "wecolab": ["wecolab", "supercolab", "ultracolab"]
    };

    function normalizePlanName(name) {
        if (!name || typeof name !== 'string') return '';
        return name.replace(/-/g, ' ').trim();
    }

    function titleCase(s) {
        if (!s) return s;
        if (s.toLowerCase() === 'cw') return 'CW'; // ✅ opcional aplicado
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function getCanonicalPlanGroup(normalizedName, originalName) {
        const lower = (normalizedName || '').toLowerCase();
        const compact = lower.replace(/\s+/g, ''); // ✅ FIX PRINCIPAL

        const words = lower.split(/\s+/).filter(Boolean);
        const second = words[1] || null;

        if (second && ["wecolab", "supercolab", "ultracolab"].includes(second)) {
            return 'Wecolab';
        }

        for (const key in PLAN_GROUPS_MAP) {
            const kws = PLAN_GROUPS_MAP[key];
            for (const kw of kws) {
                if (compact.includes(kw)) { // ✅ usa versão sem espaço
                    return titleCase(key);
                }
            }
        }

        let fallback = normalizedName.replace(/^wevets\s+/i, '').trim();
        if (!fallback) fallback = originalName || normalizedName;

        return titleCase(fallback);
    }

    function sanitizePlanName(name) {
        if (!name || typeof name !== 'string') return '';
        let out = name;
        out = out.replace(/\[\s*teste\s*\]/gi, '');
        out = out.replace(/\bteste\b/gi, '');
        out = out.replace(/\bvalor simples mensal\b/gi, '');
        out = out.replace(/\d{1,3}(?:[.,]\d{2})/g, '');
        out = out.replace(/\d+\s*%/g, '');
        out = out.replace(/\(\s*[^)]*exclusiv\w*[^)]*\)/gi, '');
        out = out.replace(/\bexclusiv\w*\b/gi, '');
        out = out.replace(/\bflocker\b\s*$/gi, 'Flocker');
        out = out.replace(/\s+\(/g, ' (').replace(/\s{2,}/g, ' ').trim();
        out = out.replace(/\(\s*\)/g, '');
        out = out.replace(/\s+([,;:.!?)])/g, '$1');
        return out.trim();
    }

    function normalizeOutputPlanName(name) {
        if (!name || typeof name !== 'string') return '';
        let out = sanitizePlanName(name);
        out = out.replace(/-/g, ' ');
        out = out.replace(/\s{2,}/g, ' ').trim();
        out = out.replace(/^wevets\b/i, 'WeVets');
        return out;
    }

    function normalizePlanKey(name) {
        if (!name || typeof name !== 'string') return '';
        return name
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/^wevets\s+/i, '')
            .replace(/\d{1,3}(?:[.,]\d{2})/g, '')
            .replace(/\bteste\b/gi, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\bvalor simples mensal\b/gi, '')
            .replace(/\bexclusiv\w*\b/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function groupPlans(plansArray) {
        const map = {};
        (plansArray || []).forEach(plan => {
            const name = plan?.name || '';
            const cleaned = normalizeOutputPlanName(name);
            const planKey = normalizePlanKey(cleaned);
            if (!planKey) return;

            const normalized = normalizePlanName(cleaned);
            const group = getCanonicalPlanGroup(normalized, cleaned);

            if (!map[group]) map[group] = [];

            const exists = map[group].some(
                existing => normalizePlanKey(existing.name) === planKey
            );

            if (!exists) {
                map[group].push({ _id: plan._id, name: cleaned });
            }
        });
        return map;
    }

    const tipoUnidadeVolante2 = "6821e5fac499684446623236";
    const tipoUnidadeVolante3 = "68bf87bb450d37004758e89b";
    const tipoUnidadeMudeiONome = "689c773e7201995696e9c906";

    const UNIT_TYPE_IDS_BLOQUEADOS = new Set([
        tipoUnidadeVolante2,
        tipoUnidadeVolante3,
        tipoUnidadeMudeiONome
    ]);

    function hasVolanteCategory(additionalData) {
        return Array.isArray(additionalData) && additionalData.some(
            item => UNIT_TYPE_IDS_BLOQUEADOS.has(item.category?._id)
        );
    }

    function hasInternalUnit(additionalData) {
        return Array.isArray(additionalData) && additionalData.some(
            item => item.isInternalUnit === true
        );
    }

    _output = {
        _id: unit._id || "",
        name: unit.name?.trim() || "",
        logo: logo,

        address: {
            country: "Brazil",
            state: address.state || null,
            city: address.city || null,
            quarter: address.quarter || null,
            street: address.street || null,
            number: address.number || null,
            zip_code: address.zipcode || null,
            complement: address.complement || null,
            coordinates: coord ? [lng, lat] : null
        },

        phones: (unit.phones || []).map(phone => ({
            ddi: phone.ddi || null,
            number: phone.number || null,
            branch: phone.branch || null,
            type: phone.type?.name || null
        })),

        unitType: (function () {
            const isVolante = hasVolanteCategory(unit.additionalData);
            const isInternal = hasInternalUnit(unit.additionalData);

            if (isVolante) {
                return { name: "Volante", id: "volante" };
            } else if (isInternal) {
                return { name: "Rede WeVets", id: "rede_wevets" };
            } else {
                return { name: "Rede Credenciada", id: "rede_credenciada" };
            }
        })(),

        acceptedPlans: (function () {
            const grouped = groupPlans(additionalData.plansServiced || []);

            return Object.keys(grouped).map(groupName => {
                const variants = grouped[groupName];

                // pega o primeiro ID só para manter compatibilidade
                const first = variants[0];

                // nome final padronizado
                let finalName = `WeVets ${groupName}`;

                // 🔥 garante CW sempre correto
                if (groupName === 'CW') {
                    finalName = 'WeVets CW';
                }

                return {
                    _id: first._id,
                    name: finalName
                };
            });
        })(),

        serviceModel: (unit.serviceModel || []).map(sm => ({
            _id: sm._id,
            title: sm.name || null
        })),

        geolocation: {
            lat: lat,
            lng: lng,
            radius: null
        },

        openingStatus: openingStatus,
        description: additionalData.description || null,

        businessHours: businessHoursList.map(bh => ({
            day: bh.day || "",
            open: !!bh.open,
            openingTime: bh.openingTime || null,
            closingTime: bh.closingTime || null
        }))
    };

} catch (error) {
    _output = {
        success: false,
        error: error.message || "Erro interno ao processar a requisição da unidade."
    };
}
