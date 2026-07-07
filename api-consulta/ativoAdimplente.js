let error;

try {
    mainFunction();
} catch (e) {
    error = _utils.stringifyAsJson(e);
    generateOutput(false, "Erro inesperado: " + e.stack);
}

function mainFunction() {
    const input = _input.cpf

    if (!String(input || "").trim()) {
        generateOutput(false, "Informe cpf ou telefone.");
        return;
    }

    const personResult = findPersonByInput(input);

    if (!personResult?.person?._id) {
        generateOutput(false, {
            message: "Pessoa não encontrada",
            searched: personResult?.searched
        });
        return;
    }

    const person = personResult.person;

    // Buscar tutor
    const tutor = br.com.wevets.crm.Tutor._search({
        query: { term: { "person._id": person._id } },
        size: 1
    }).hits.hits[0]?._source;

    if (!tutor?._id) {
        generateOutput(false, "Tutor não encontrado.");
        return;
    }

    // =========================
    // MAPAS (EDITAR FACILMENTE)
    // =========================


    const SERVICE_STATE_MAP = {
        "59726354ce027221e44534fb": "Ativo",
        "59726365ce027221e44534ff": "Cancelado",
        "681e08492bd1602c4a991696": "Suspenso" // confirmar depois
    };

    const FINANCIAL_STATE_MAP = {
        "5972639bce027221e4453507": "Adimplente",
        "597263a3ce027221e4453509": "Inadimplente"
    };


    // Buscar memberships
    const memberships = br.com.wevets.membershipManagement.Membership._search({
        size: 9999,
        query: {
            term: { "contract.buyer._id": person._id }
        }
    }).hits.hits || [];

    const pets = memberships.map(hit => {
        const m = hit._source;

        const contract = m?.contract;
        const states = contract?.contractStates;

        const serviceId = states?.serviceState?._id || null;
        const financialId = states?.financialState?._id || null;

        const serviceName = SERVICE_STATE_MAP[serviceId] || "Desconhecido";
        const financialName = FINANCIAL_STATE_MAP[financialId] || "Desconhecido";

        // fallback antigo
        let subscriptionStatus = null;

        if (m?.subscriptionStatus?._id) {
            try {
                const statusObj = br.com.wevets.membershipManagement.SubscriptionStatus._get({
                    _id: m.subscriptionStatus._id
                });
                subscriptionStatus = statusObj?.displayName || null;
            } catch (e) {
                subscriptionStatus = null;
            }
        }

        return {
            id: m?._id || null,
            guruvet_id: m?.pet?.externalCodeGuruvet || null,
            nome: m?.pet?.name || null,
            especie: m?.pet?.species || null,
            raca: m?.pet?.breed || null,
            idade: m?.pet?.age || null,

            plano: {
                codigo: m?.contract?.product?.externalCode || null,
                nome: m?.contract?.product?.name || null,

                // antigo
                status: subscriptionStatus,

                // ✅ NOVO PADRÃO PROFISSIONAL
                service_state: {
                    id: serviceId,
                    name: serviceName
                },
                financial_state: {
                    id: financialId,
                    name: financialName
                },

                data_de_ativacao: formatDate(
                    m?.activationDate ||
                    m?.contract?.activationDate
                ),
                data_de_vigencia: formatDate(m?.startDate)
            }
        };
    });

    const response = {
        tutor: {
            id: tutor?._id || null,
            nome: person?.name || null,
            cpf: person?.documents?.[0]?.number || null,
            telefone: formatPhone(person?.phones?.[0]?.number),
            email: person?.emails?.[0]?.email || person?.email || null,
            endereco: {
                cep: person?.addresses?.[0]?.zipcode || null,
                logradouro: person?.addresses?.[0]?.street || null,
                numero: person?.addresses?.[0]?.number || null,
                complemento: person?.addresses?.[0]?.complement || null,
                bairro: person?.addresses?.[0]?.quarter || null,
                cidade: person?.addresses?.[0]?.city || null,
                estado: formatState(person?.addresses?.[0]?.state),
                pais: formatCountry(person?.addresses?.[0]?.country)
            }
        },
        pets: pets
    };

    generateOutput(true, response);
}

// =========================
// BUSCA PESSOA
// =========================

function findPersonByInput(input) {
    const rawInput = String(input || "").trim();
    const digits = rawInput.replace(/\D/g, "");

    if (!digits) {
        return { person: null, searched: { raw: rawInput } };
    }

    if (digits.length === 11) {
        const p = crm.person.findByCPF({ cpf: digits });
        if (p?._id) return { person: p };
    }

    let digitsNo55 = digits;
    if (digits.length > 11 && digits.indexOf("55") === 0) {
        digitsNo55 = digits.substring(2);
    }

    const result = crm.person._search({
        query: {
            nested: {
                path: "phones",
                query: {
                    bool: {
                        should: [
                            { term: { "phones.number": digits } },
                            { term: { "phones.number": digitsNo55 } }
                        ]
                    }
                }
            }
        },
        size: 1
    });

    return {
        person: result?.hits?.hits?.[0]?._source || null
    };
}

// =========================
// OUTPUT
// =========================

function generateOutput(success, data) {
    _output = {
        success: success,
        data: success ? data : null,
        error: success ? null : data
    };
}

// =========================
// HELPERS
// =========================

function formatDate(dateVal) {
    if (!dateVal) return null;

    if (typeof dateVal === "string") {
        return dateVal.split("T")[0];
    }

    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function formatPhone(phone) {
    if (!phone) return null;

    const digits = String(phone).replace(/\D/g, "");

    if (digits.startsWith("55")) return "+" + digits;

    return "+55" + digits;
}

function formatState(state) {
    if (!state) return null;

    const map = {
        "São Paulo": "SP",
        "Rio de Janeiro": "RJ",
        "Minas Gerais": "MG",
        "Bahia": "BA",
        "Paraná": "PR",
        "Santa Catarina": "SC",
        "Rio Grande do Sul": "RS"
    };

    return map[state] || state;
}

function formatCountry(country) {
    if (!country) return "Brasil";
    if (typeof country === "string") return country;
    return country.name || "Brasil";
}
