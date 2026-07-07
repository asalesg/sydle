let error;

try {
    mainFunction();
} catch (e) {
    error = _utils.stringifyAsJson(e);
    generateOutput(false, "Erro inesperado: " + e.stack);
}

function mainFunction() {

    const input = _input.cpf;

    if (!String(input || "").trim()) {
        generateOutput(false, "Informe cpf ou telefone.");
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

    // Buscar tutor
    const tutorResult = br.com.wevets.crm.Tutor._search({
        query: {
            term: {
                "person._id": person._id
            }
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
    // MAPAS
    // =========================

    const SERVICE_STATE_MAP = {
        "59726354ce027221e44534fb": "Ativo",
        "59726365ce027221e44534ff": "Cancelado",
        "681e08492bd1602c4a991696": "Suspenso"
    };

    const FINANCIAL_STATE_MAP = {
        "5972639bce027221e4453507": "Adimplente",
        "597263a3ce027221e4453509": "Inadimplente"
    };

    const COVERAGE_STATUS_MAP = {
        "685d8026d34b750e86936751": "Cobertura Ativa"
    };

    // =========================
    // MEMBERSHIPS
    // =========================

    const memberships =
        br.com.wevets.membershipManagement.Membership._search({
            size: 9999,
            query: {
                term: {
                    "contract.buyer._id": person._id
                }
            }
        }).hits.hits || [];

    const pets = memberships.map(function (hit) {

        const m = hit._source;

        const contract = m && m.contract
            ? m.contract
            : null;

        const states =
            contract &&
                contract.contractStates
                ? contract.contractStates
                : null;

        const serviceId =
            states &&
                states.serviceState
                ? states.serviceState._id
                : null;

        const financialId =
            states &&
                states.financialState
                ? states.financialState._id
                : null;

        const serviceName =
            SERVICE_STATE_MAP[serviceId] || "Desconhecido";

        const financialName =
            FINANCIAL_STATE_MAP[financialId] || "Desconhecido";

        // =========================
        // SUBSCRIPTION STATUS
        // =========================

        let subscriptionStatus = null;

        if (
            m &&
            m.subscriptionStatus &&
            m.subscriptionStatus._id
        ) {
            try {

                const statusObj =
                    br.com.wevets.membershipManagement.SubscriptionStatus._get({
                        _id: m.subscriptionStatus._id
                    });

                subscriptionStatus =
                    statusObj &&
                        statusObj.displayName
                        ? statusObj.displayName
                        : null;

            } catch (e) {
                subscriptionStatus = null;
            }
        }

        // =========================
        // COBERTURA
        // =========================

        const coverageId =
            m &&
                m.coverage &&
                m.coverage.coverageStatus
                ? m.coverage.coverageStatus._id
                : null;

        const coverageName =
            COVERAGE_STATUS_MAP[coverageId] || "A definir";

        /*
         * Regra observada:
         * status conhecido de cobertura = serviço liberado.
         *
         * Caso apareça um novo coverageStatus futuramente,
         * ele virá como "A definir" e poderá ser mapeado.
         */
        const allowsMedicalService =
            financialId === "5972639bce027221e4453507";

        return {

            id: m ? m._id : null,

            guruvet_id:
                m &&
                    m.pet
                    ? m.pet.externalCodeGuruvet
                    : null,

            nome:
                m &&
                    m.pet
                    ? m.pet.name
                    : null,

            especie:
                m &&
                    m.pet
                    ? m.pet.specie
                    : null,

            raca:
                m &&
                    m.pet
                    ? m.pet.breed
                    : null,

            idade:
                m &&
                    m.pet
                    ? m.pet.age
                    : null,

            plano: {

                codigo:
                    contract &&
                        contract.product
                        ? contract.product.externalCode
                        : null,

                nome:
                    contract &&
                        contract.product
                        ? contract.product.name
                        : null,

                status: subscriptionStatus,

                service_state: {
                    id: serviceId,
                    name: serviceName
                },

                financial_state: {
                    id: financialId,
                    name: financialName
                },

                cobertura: {
                    status: {
                        id: coverageId,
                        name: coverageName
                    }
                },

                allowsMedicalService: allowsMedicalService,

                data_de_ativacao: formatDate(
                    (m ? m.activationDate : null) ||
                    (contract ? contract.activationDate : null)
                ),

                data_de_vigencia: formatDate(
                    m ? m.startDate : null
                )
            }
        };
    });

    const response = {

        tutor: {

            id: tutor._id || null,

            nome: person.name || null,

            cpf:
                person.documents &&
                    person.documents.length
                    ? person.documents[0].number
                    : null,

            telefone: formatPhone(
                person.phones &&
                    person.phones.length
                    ? person.phones[0].number
                    : null
            ),

            email:
                (
                    person.emails &&
                        person.emails.length
                        ? person.emails[0].email
                        : null
                ) ||
                person.email ||
                null,

            endereco: {

                cep:
                    person.addresses &&
                        person.addresses.length
                        ? person.addresses[0].zipcode
                        : null,

                logradouro:
                    person.addresses &&
                        person.addresses.length
                        ? person.addresses[0].street
                        : null,

                numero:
                    person.addresses &&
                        person.addresses.length
                        ? person.addresses[0].number
                        : null,

                complemento:
                    person.addresses &&
                        person.addresses.length
                        ? person.addresses[0].complement
                        : null,

                bairro:
                    person.addresses &&
                        person.addresses.length
                        ? person.addresses[0].quarter
                        : null,

                cidade:
                    person.addresses &&
                        person.addresses.length
                        ? person.addresses[0].city
                        : null,

                estado: formatState(
                    person.addresses &&
                        person.addresses.length
                        ? person.addresses[0].state
                        : null
                ),

                pais: formatCountry(
                    person.addresses &&
                        person.addresses.length
                        ? person.addresses[0].country
                        : null
                )
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
        return {
            person: null,
            searched: {
                raw: rawInput
            }
        };
    }

    if (digits.length === 11) {

        const p = crm.person.findByCPF({
            cpf: digits
        });

        if (p && p._id) {
            return {
                person: p
            };
        }
    }

    let digitsNo55 = digits;

    if (
        digits.length > 11 &&
        digits.indexOf("55") === 0
    ) {
        digitsNo55 = digits.substring(2);
    }

    const result = crm.person._search({
        query: {
            nested: {
                path: "phones",
                query: {
                    bool: {
                        should: [
                            {
                                term: {
                                    "phones.number": digits
                                }
                            },
                            {
                                term: {
                                    "phones.number": digitsNo55
                                }
                            }
                        ]
                    }
                }
            }
        },
        size: 1
    });

    return {
        person:
            result &&
                result.hits &&
                result.hits.hits &&
                result.hits.hits.length
                ? result.hits.hits[0]._source
                : null
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

    if (!dateVal) {
        return null;
    }

    try {

        if (typeof dateVal === "string") {
            return dateVal.split("T")[0];
        }

        const d = new Date(dateVal);

        if (isNaN(d.getTime())) {
            return null;
        }

        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");

        return year + "-" + month + "-" + day;

    } catch (e) {

        return null;
    }
}

function formatPhone(phone) {

    if (!phone) {
        return null;
    }

    const digits =
        String(phone)
            .replace(/\D/g, "");

    if (digits.indexOf("55") === 0) {
        return "+" + digits;
    }

    return "+55" + digits;
}

function formatState(state) {

    if (!state) {
        return null;
    }

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

    if (!country) {
        return "Brasil";
    }

    if (typeof country === "string") {
        return country;
    }

    return country.name || "Brasil";
}
