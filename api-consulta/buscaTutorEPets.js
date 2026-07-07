let error;

try {
    mainFunction();
} catch (e) {
    error = _utils.stringifyAsJson(e);
    generateOutput(false, "Erro inesperado: " + e.stack);
}

function mainFunction() {

    // Input preferencial: TELEFONE. Mantém compatibilidade com cpf/input genérico.
    const input = _input.telefone || _input.phone || _input.cpf || _input.input;

    if (!String(input || "").trim()) {
        generateOutput(false, "Informe telefone ou cpf.");
        return;
    }

    const personResult = findPersonByInput(input);

    if (!personResult || !personResult.person || !personResult.person._id) {
        generateOutput(false, {
            message: "Pessoa não encontrada",
            searched: personResult ? personResult.searched : null
        });
        return;
    }

    const person = personResult.person;

    // =========================
    // BUSCAR TUTOR
    // =========================

    const tutorResult = br.com.wevets.crm.Tutor._search({
        query: {
            term: { "person._id": person._id }
        },
        size: 1
    });

    const tutor =
        tutorResult &&
            tutorResult.hits &&
            tutorResult.hits.hits &&
            tutorResult.hits.hits.length
            ? tutorResult.hits.hits[0]._source
            : null;

    if (!tutor || !tutor._id) {
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

    const COVERAGE_STATUS_MAP = {
        "685d8026d34b750e86936751": "Cobertura Ativa"
    };

    // =========================
    // 1) TODOS OS PETS DO TUTOR (com ou sem assinatura)
    // =========================
    // ATENÇÃO: ajuste "br.com.wevets.crm.Pet" abaixo caso o pacote real da
    // classe Pet seja diferente no seu domínio (não encontramos essa
    // referência explícita nos exemplos fornecidos, apenas o _classId
    // "67cb1deb3e99751e7075351e" dos objetos Pet).
    const PetClass = br.com.wevets.crm.Pet;

    let petsHits = [];

    try {
        // Tentativa 1: campo "tutors" mapeado como nested
        petsHits = PetClass._search({
            size: 9999,
            query: {
                nested: {
                    path: "tutors",
                    query: { term: { "tutors._id": tutor._id } }
                }
            }
        }).hits.hits || [];
    } catch (e1) {
        try {
            // Tentativa 2 (fallback): campo "tutors" não é nested
            petsHits = PetClass._search({
                size: 9999,
                query: { term: { "tutors._id": tutor._id } }
            }).hits.hits || [];
        } catch (e2) {
            petsHits = [];
        }
    }

    // =========================
    // 2) TODAS AS MEMBERSHIPS DO COMPRADOR (para localizar o plano de cada pet)
    // =========================

    const membershipHits =
        br.com.wevets.membershipManagement.Membership._search({
            size: 9999,
            query: {
                term: { "contract.buyer._id": person._id }
            }
        }).hits.hits || [];

    function getMembershipPriority(membership) {
        if (!membership) {
            return { isActive: false, dateValue: 0 };
        }

        const contract = membership && membership.contract ? membership.contract : null;
        const states = contract && contract.contractStates ? contract.contractStates : null;
        const serviceId = states && states.serviceState ? states.serviceState._id : null;
        const financialId = states && states.financialState ? states.financialState._id : null;

        const serviceName = SERVICE_STATE_MAP[serviceId] || "Desconhecido";
        const financialName = FINANCIAL_STATE_MAP[financialId] || "Desconhecido";
        const isActive = serviceName === "Ativo" && financialName === "Adimplente";

        const rawDate = membership.activationDate || membership.startDate || null;
        const dateValue = rawDate ? Date.parse(rawDate) : 0;

        return {
            isActive: isActive,
            dateValue: isNaN(dateValue) ? 0 : dateValue
        };
    }

    function isPreferredMembership(candidate, current) {
        const candidatePriority = getMembershipPriority(candidate);
        const currentPriority = getMembershipPriority(current);

        if (candidatePriority.dateValue !== currentPriority.dateValue) {
            return candidatePriority.dateValue > currentPriority.dateValue;
        }

        if (candidatePriority.isActive !== currentPriority.isActive) {
            return candidatePriority.isActive;
        }

        return (candidate && candidate._id || "") > (current && current._id || "");
    }

    // Index: pet._id -> membership._source (prioriza a ativa/mais recente)
    const membershipByPetId = {};
    membershipHits.forEach(function (hit) {
        const m = hit._source;
        const petId = m && m.pet ? m.pet._id : null;
        if (!petId) {
            return;
        }

        const currentMembership = membershipByPetId[petId];
        if (!currentMembership || isPreferredMembership(m, currentMembership)) {
            membershipByPetId[petId] = m;
        }
    });

    // =========================
    // 3) MONTAR LISTA FINAL DE PETS (com e sem assinatura)
    // =========================

    const pets = petsHits.map(function (hit) {

        const pet = hit._source;
        const membership = membershipByPetId[pet._id] || null;

        const contract = membership && membership.contract ? membership.contract : null;
        const states = contract && contract.contractStates ? contract.contractStates : null;

        const serviceId = states && states.serviceState ? states.serviceState._id : null;
        const financialId = states && states.financialState ? states.financialState._id : null;

        const serviceName = SERVICE_STATE_MAP[serviceId] || (membership ? "Desconhecido" : "Sem assinatura");
        const financialName = FINANCIAL_STATE_MAP[financialId] || (membership ? "Desconhecido" : "Sem assinatura");

        // status antigo (fallback)
        let subscriptionStatus = null;
        if (membership && membership.subscriptionStatus && membership.subscriptionStatus._id) {
            try {
                const statusObj = br.com.wevets.membershipManagement.SubscriptionStatus._get({
                    _id: membership.subscriptionStatus._id
                });
                subscriptionStatus = statusObj && statusObj.displayName ? statusObj.displayName : null;
            } catch (e) {
                subscriptionStatus = null;
            }
        }

        // ✅ REGRA SOLICITADA: allowsMedicalService = true quando financial_state.name === "Adimplente" E service_state.name === "Ativo"
        const allowsMedicalService = financialName === "Adimplente" && serviceName === "Ativo";

        // ✅ CÓDIGO DO PLANO: o Product vem como referência e o código real
        // costuma estar em classificationParameters.planCode.
        const productCode =
            contract && contract.product
                ? (
                    (contract.product.classificationParameters && contract.product.classificationParameters.planCode) ||
                    contract.product.planCode ||
                    contract.product.externalCode ||
                    contract.product.code ||
                    contract.product.sku ||
                    null
                )
                : null;

        return {
            id: pet._id || null,
            guruvet_id: pet.externalCodeGuruvet || null,
            nome: pet.name || null,
            especie: pet.specie ? pet.specie.type : null,
            raca: pet.breed && typeof pet.breed === 'object' ? pet.breed.breed : (pet.breed || null),
            idade: pet.age || null,

            possui_assinatura: !!membership,


            plano: {
                codigo: productCode,
                nome: contract && contract.product ? contract.product.name : null,


                // antigo
                status: membership ? subscriptionStatus : "Sem assinatura",

                service_state: {
                    id: serviceId,
                    name: serviceName
                },
                financial_state: {
                    id: financialId,
                    name: financialName
                },

                // ✅ NOVO CAMPO
                allowsMedicalService: allowsMedicalService,

                data_de_ativacao: formatDate(
                    (membership ? membership.activationDate : null) ||
                    (contract ? contract.activationDate : null)
                ),
                data_de_vigencia: formatDate(
                    (membership && membership.validityDate) ||
                    (contract && contract.validityDate) ||
                    (membership && membership.endDate) ||
                    (membership && membership.expirationDate) ||
                    (membership && membership.validUntil) ||
                    (contract && contract.endDate) ||
                    (contract && contract.expirationDate) ||
                    (contract && contract.validUntil) ||
                    (membership ? membership.startDate : null)
                )
            }
        };
    });

    // =========================
    // RESPOSTA FINAL
    // =========================

    const response = {
        tutor: {
            id: tutor._id || null,
            nome: person.name || null,
            cpf: person.documents && person.documents.length ? person.documents[0].number : null,
            telefone: formatPhone(person.phones && person.phones.length ? person.phones[0].number : null),
            email: (person.emails && person.emails.length ? person.emails[0].email : null) || person.email || null,
            endereco: {
                cep: person.addresses && person.addresses.length ? person.addresses[0].zipcode : null,
                logradouro: person.addresses && person.addresses.length ? person.addresses[0].street : null,
                numero: person.addresses && person.addresses.length ? person.addresses[0].number : null,
                complemento: person.addresses && person.addresses.length ? person.addresses[0].complement : null,
                bairro: person.addresses && person.addresses.length ? person.addresses[0].quarter : null,
                cidade: person.addresses && person.addresses.length ? person.addresses[0].city : null,
                estado: formatState(person.addresses && person.addresses.length ? person.addresses[0].state : null),
                pais: formatCountry(person.addresses && person.addresses.length ? person.addresses[0].country : null)
            }
        },
        pets: pets
    };

    generateOutput(true, response);
}

// =========================
// BUSCA PESSOA (TELEFONE PRIMEIRO, DEPOIS CPF)
// =========================

function findPersonByInput(input) {

    const rawInput = String(input || "").trim();
    const digits = rawInput.replace(/\D/g, "");

    if (!digits) {
        return { person: null, searched: { raw: rawInput } };
    }

    // 1) TELEFONE (preferencial)
    let digitsNo55 = digits;
    if (digits.length > 11 && digits.indexOf("55") === 0) {
        digitsNo55 = digits.substring(2);
    }

    const phoneResult = crm.person._search({
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

    const foundByPhone =
        phoneResult &&
            phoneResult.hits &&
            phoneResult.hits.hits &&
            phoneResult.hits.hits.length
            ? phoneResult.hits.hits[0]._source
            : null;

    if (foundByPhone && foundByPhone._id) {
        return { person: foundByPhone };
    }

    // 2) FALLBACK: CPF (11 dígitos)
    if (digits.length === 11) {
        const p = crm.person.findByCPF({ cpf: digits });
        if (p && p._id) {
            return { person: p };
        }
    }

    return {
        person: null,
        searched: { raw: rawInput, digits: digits }
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

    try {
        if (typeof dateVal === "string") {
            return dateVal.split("T")[0];
        }

        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return null;

        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");

        return year + "-" + month + "-" + day;
    } catch (e) {
        return null;
    }
}

function formatPhone(phone) {
    if (!phone) return null;

    const digits = String(phone).replace(/\D/g, "");

    if (digits.indexOf("55") === 0) return "+" + digits;

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
