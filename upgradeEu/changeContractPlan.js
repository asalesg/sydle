/**
 * Altera o plano do contrato.
 * 
 * @param {string} _id - Identificador do contrato
 * @param {Object} newPlan - Novo plano do contrato, com seus devidos componentes (billing.planChange)
 * @param {string} [contractValidity] - Indica se a vigência do contrato, caso exista, continuará a mesma ou iniciará uma nova após a troca do plano
 * @param {Boolean} [generatePlanChangeInvoice] - Se falso, o cálculo de pró-rata devido a troca do plano será feita na próxima fatura, se verdadeiro, será gerada uma fatura imediatamente com as devidas cobranças
 * @param {Boolean} [keepContractReferenceDate] - Indica se a troca manterá a data de referência de venda do contrato
 * @param {Boolean} [ignoreProrataDiscounts] - Se verdadeiro, não será gerado nenhum estorno em caso de mudança para um plano de menor valor
 * @param {Boolean} [simulate] - Se verdadeiro, simula a fatura, sem persistir os dados e sem gerar registro de evento
 * @param {Boolean} [ignoreContractChangeValidation] - Se verdadeiro, ignora validação da mudança e não gera registro de evento
 * @param {Object} [paymentCondition] - Condição de pagamento da fatura gerada (billing.paymentCondition)
 * @param {Boolean} [collectImmediately] - Se verdadeiro, a remessa será gerada automaticamente junto à fatura
 * @param {Boolean} [changeBillingDays] - Indica que será alterado os dados de cobrança do contrato
 * @param {Object} [billingDays] - Novos dados de cobrança do contrato (billing.billingDays)
 * @param {Boolean} [changeBaseDateReadjust] - Indica que a data base de reajuste do contrato será alterada
 * @param {Date} [newBaseDate] - Nova data base de reajuste do contrato
 * @param {Object} [eventType] - Tipo do evento para registro de log
 * @returns {Object} invoice/contract - Fatura de upgrade de plano ou contrato atualizado
 * @throws Lancará um erro se algum campo obrigatório não for informado
 */

let moment = require("/_internal/moment");

if (!_object && !_input.contract) {
    //Falha ao obter o contrato!
    throw _system._translation.getUnit({ bundle: "BILLING_MESSAGES", unit: "ERROR_GET_CONTRACT_FAILED" })._current;
}

let contract = _object || billing.contract._get(_input.contract);

const PLAN_CHANGE_EVENT_TYPE_ID = "5cc19e563a0b2071bff96d76";
const PLAN_UPGRADE_EVENT_TYPE_ID = "5e6f7b4e8c19b766dafeac82";
const PLAN_DOWNGRADE_EVENT_TYPE_ID = "62bb42727ad91b6076fc300c";
const simulate = _input.simulate;

// As variaveis mudaram para refletir melhor suas funções, o trecho abaixo foi adicionado para que o metodo seja retrocompativel
// No caso do antigo campo vir preenchido, e o novo nulo, o antigo é tido como correto
const keepContractReferenceDate = (_input.keepReferenceDate != null && _input.keepContractReferenceDate == null) ? _input.keepReferenceDate : _input.keepContractReferenceDate;
const generatePlanChangeInvoice = (_input.chargeNextInvoice != null && _input.generatePlanChangeInvoice == null) ? !_input.chargeNextInvoice : _input.generatePlanChangeInvoice;
const ignoreProrataDiscounts = (_input.generateInvoiceBalance != null && _input.ignoreProrataDiscounts == null) ? !_input.generateInvoiceBalance : _input.ignoreProrataDiscounts;

let newPlan = _input.newPlan;
let currentPlan = _input.currentPlan;

if (!newPlan || !currentPlan) {
    throw _system._translation.getUnit({ bundle: "BILLING_MESSAGES", unit: "REQUIRED_PARAMETERS_ERROR" })._current;
}

let dealUpdate = billing.planChange.hasPricingUpdate({ "currentPlan": currentPlan, "newPlan": newPlan });

let isUpgrade = dealUpdate.isUpgrade;
let isDowngrade = dealUpdate.isDowngrade;
let eventType = setEventType(_input.eventType, isUpgrade, isDowngrade);

let ignoreContractChangeValidation = _input.ignoreContractChangeValidation;
let eventDate = _input.eventDate ? new Date(_input.eventDate) : new Date();
let classificationParameters = newPlan.classificationParameters;
let collectImediately = _input.collectImmediately;
let oldContractValidity = null;
let contractValidity = null;
let oldBillingDays = null;
let planChanged = false;
let billingDays = null;
let dependents = null;

_output.invoices = [];

// Verifica se existem itens duplicados que não permitem multiplicidade.
newPlan.components?.forEach((item, index) => {
    // Verifica se existe outro item com o mesmo componente.
    let otherIndex = newPlan.components?.findIndex(el => el?.planComponent?._id === item?.planComponent?._id);

    // Se houver outro e esse componente não for múltiplo, emite erro.
    if (otherIndex !== index && !item.planComponent.multiple) {
        throw _system._translation.getUnit({
            bundle: 'BILLING_MESSAGES',
            unit: 'ERROR_INVALID_DUPLICATED_COMPONENT',
            args: [item.planComponent.name]
        })._current;
    }
});

const planChange = !areSamePlan(currentPlan, newPlan);
let isPlanFlexible = newPlan.plan?.bundleType === "soft";
// So verifica se houve alteração no plano, do contrário as regras não são verificadas.
let components = newPlan.components?.filter(component => component?.planComponent);
if (isPlanFlexible) {
    let plan = newPlan.plan;

    if (planChange) {
        if (components.length > 0) {
            let params = {
                items: components,
            }

            let response = com.sydle.billing.productCatalog.planComponent.checkRelationshipRules(params);

            if (!response?.componentsResponse?.success || response?.componentsResponse?.hasRulesViolated) {
                throw _system._translation.getUnit({
                    bundle: 'BILLING_MESSAGES',
                    unit: 'RELATIONSHIP_RULE_VIOLATION_ERROR',
                    args: [response.conflictingComponents.map(r => r.name)]
                })._current
            }

            let notIncludedComponents = response?.notIncludedComponents;

            if (notIncludedComponents && notIncludedComponents.length > 0) {
                throw _system._translation.getUnit({
                    bundle: 'BILLING_MESSAGES',
                    unit: 'ERROR_RELATIONSHIP_RULES_VIOLATED'
                })._current;
            }

            if ((plan.maxComponents && newPlan.components) && newPlan.components.length > plan.maxComponents) {
                throw _system._translation.getUnit({
                    bundle: 'BILLING_MESSAGES',
                    unit: 'MAX_COMPONENTS_LIMIT_EXCEEDED_ERROR',
                    args: [plan.maxComponents]
                })._current;
            }

            if (response?.hasMissingDependencies) {
                throw _system._translation.getUnit({
                    bundle: 'BILLING_MESSAGES',
                    unit: 'MISSING_CLASSIFICATION_DEPENDENCIES',
                    args: [response?.missingDependencies]
                })._current;
            }

            if (!response?.classificationResponse?.success || response?.classificationResponse?.hasRulesViolated) {
                throw _system._translation.getUnit({
                    bundle: 'BILLING_MESSAGES',
                    unit: 'ERROR_CLASSIFICATION_RULES_VIOLATED'
                })._current;
            }
        }
        validateNewComponents(contract, newPlan);
    }
}

components.forEach(component => {
    if (component?.active) {
        // Obtém os componentes relacionados
        const response = getRelatedComponents([component.planComponent]);

        response.dependents.forEach(dependent => {
            components.forEach(item => {
                if (item?.planComponent?._id === dependent?._id && !item.active) {
                    throw _system._translation.getUnit({
                        bundle: 'BILLING_MESSAGES',
                        unit: 'DEPENDENT_COMPONENTS_REQUIRED_ERROR',
                        args: [[item?.planComponent?.name, component.planComponent?.name]]
                    })._current;
                }
            });
        });
    } else if (component?.active === false) {
        // Obtém os componentes dependentes
        const dependentComponents = getDependentComponents(component.planComponent);

        dependentComponents.forEach(dependent => {
            components.forEach(item => {
                if (item?.planComponent?._id === dependent?._id && item.active) {
                    throw _system._translation.getUnit({
                        bundle: 'BILLING_MESSAGES',
                        unit: 'DEPENDENT_COMPONENTS_REQUIRED_ERROR',
                        args: [[item?.planComponent?.name, component.planComponent?.name]]
                    })._current;
                }
            });
        });
    }
});

if (_input.changeBillingDays) {
    billingDays = _input.billingDays;
    oldBillingDays = contract.billingDays;
}
// Compara se o plano foi alterado e se é necessário criar uma nova vigência contratual
if (shouldRenewContract(currentPlan, newPlan)) {
    planChanged = true;
    checkFamilyPlanChange();

    // Vigência contratual
    if (_input.contractValidity && _input.contractValidity === "initiateNew") {
        oldContractValidity = contract.contractValidity;
        contractValidity = {};

        // remover após correção do bug de lazy load do _input
        let plan = com.sydle.billing.productCatalog.plan._get({
            _id: newPlan.plan._id
        });

        if (!plan?.contractValidityData) {
            throw _system._translation.getUnit({
                bundle: 'BILLING_MESSAGES',
                unit: 'ERROR_PLAN_NOT_HAVE_CONTRACT_VALIDITY_DATA',
            })._current;
        }

        contractValidity.automaticRenewal = plan.contractValidityData.automaticRenewal;
        contractValidity.beginDate = eventDate;
        let endDate = moment(eventDate).add('months', plan.contractValidityData.period);
        endDate.subtract('days', 1);
        contractValidity.endDate = new Date(endDate);
        contractValidity.fidelity = plan.contractValidityData.fidelity;
        contractValidity.renewFidelity = plan.contractValidityData.renewFidelity;
    }
}

// Valida se não há uma alteração do contrato posterior a data do evento
if (!ignoreContractChangeValidation) {
    billing.contract.validateContractChange({
        "eventDate": eventDate,
        "contractId": contract._id
    });
}

validateContractStates();
validateIfHasActiveComponent();

// Possibilita uso dos componentes atualizados antes da troca ser efetuada
let updatedContract = {
    "product": newPlan.plan,
    "productData": newPlan.components
};

if (billingDays) {
    updatedContract.billingDays = billingDays;
}

let referenceMonth = getReferenceMonth(updatedContract, eventDate);

updateComponentsActivationDate(updatedContract, eventDate, referenceMonth);

let patchOperations = [{
    "op": "replace",
    "path": "/product",
    "value": updatedContract.product
}, {
    "op": "replace",
    "path": "/productData/",
    "value": updatedContract.productData
}, {
    "op": "replace",
    "path": "/migration",
    "value": true
}, {
    "op": "replace",
    "path": "/suspensionMode",
    "value": newPlan.plan.suspensionMode
}];

if (billingDays) {
    patchOperations.push({
        "op": "replace",
        "path": "/billingDays",
        "value": billingDays
    });
}

patchOperations.push({
    "op": "replace",
    "path": "/classificationParameters",
    "value": classificationParameters
});

if (contractValidity) {
    patchOperations.push({
        "op": "replace",
        "path": "/contractValidity",
        "value": contractValidity
    });
}

if (_input.changeBaseDateReadjust && _input.newBaseDate) {
    patchOperations.push({
        "op": "replace",
        "path": "/contractReadjustmentData/baseDate",
        "value": _input.newBaseDate
    });
}

let event = !ignoreContractChangeValidation ? registerEvent(updatedContract, eventType) : null;
let invoice = null;

if (_input.invoiceQuantityToSimulate > 1 && _input.simulate) {
    simulateNInvoices();
    return;
}

if (!generatePlanChangeInvoice && !simulate) {
    contract = updateContract(contract, patchOperations, event);

    handleFamilyPlan(currentPlan.plan, newPlan.plan, contractValidity);
} else if (!ignoreContractChangeValidation) {
    if (!simulate) {
        cancelUpgradeInvoices();
    }
    invoice = invoiceContract(updatedContract, event);
    if (invoice && invoice.value > 0 && collectImediately) {
        billing.invoice.collect(invoice);
    }

    if (!simulate && ((!invoice || !invoice._id) || invoice.value <= 0)) {
        contract = updateContract(contract, patchOperations, event, invoice);

        handleFamilyPlan(currentPlan.plan, newPlan.plan, contractValidity);
    }
}

if (!simulate) {
    billing.postUtils.createMethodPost({ method: 'changeContractPlan', object: contract });
}

if (_input._methodName && !simulate) {
    _utils.addInfoMessage(_system._translation.getUnit({ bundle: "BILLING_MESSAGES", unit: "SUCESS_CHANGE_PLAN" })._current);
    _output._redirectObject = invoice ? invoice : contract;
} else {
    _output = invoice ? invoice : contract;
}

function shouldRenewContract(currentPlan, newPlan) {
    const areSamePlan = currentPlan.plan?._id === newPlan.plan?._id;
    // Caso o plano tenha sido alterado, cria nova vigência.
    if (!areSamePlan) return true;

    const isSoftBundle = newPlan.plan?.bundleType === "soft";
    // Caso o plano se mantenha, mas é flexível, então verificamos se os componentes foram alterados.
    if (areSamePlan && isSoftBundle) {
        const hasSameComponentsLength = currentPlan.components?.length === newPlan.components?.length;
        // Caso os componentes não sejam os mesmos, então não consideramos o mesmo plano.
        return !hasSameComponentsLength ||
            !newPlan.components?.every(component => {
                return currentPlan.components.some(c => {
                    component?.planComponent?._id === c?.planComponent?._id
                });
            });
    }

    return false;
}

// Caso não seja possível criar o contrato, exclui o novo evento e nova fatura associado a criação.
function updateContract(contract, patchOperations, event, invoice) {
    try {
        return billing.contract._patch({
            "_id": contract._id,
            "_operationsList": patchOperations,
            "readjust": _input.readjust,
            "validateRelationship": false
        }, { _indexStrategy: "queue" });
    } catch (error) {
        if (event?._id != null) {
            billing.eventLog._delete({ _id: event._id });
        }

        if (invoice?._id != null) {
            billing.invoice._delete({ _id: invoice._id });
        }

        throw error;
    }
}

function setEventType(inputEventType, isUpgrade, isDowngrade) {
    let eventType;

    if (inputEventType && inputEventType._id) {
        eventType = billing.eventType._get({ _id: inputEventType._id });
    }

    if (!generatePlanChangeInvoice) {
        eventType = PLAN_CHANGE_EVENT_TYPE_ID;
    } else if (!eventType) {
        eventType = isUpgrade ? PLAN_UPGRADE_EVENT_TYPE_ID : isDowngrade ? PLAN_DOWNGRADE_EVENT_TYPE_ID : PLAN_CHANGE_EVENT_TYPE_ID;
    }

    return eventType;
}

/** Registra o evento de alteração de plano e/ou componentes de um contrato */
function registerEvent(updatedContract, eventType) {

    const planChangeClass = {
        "_id": "5cc1b60e3a0b2071bff979e8",
        "_classId": "000000000000000000000000",
        "classPackageIdentifier": "_system",
        "classIdentifier": "_class"
    };

    const params = {
        'object': contract,
        'eventType': eventType,
        'oldValue': {
            'plan': currentPlan.plan,
            'components': currentPlan.components,
            'billingDays': oldBillingDays,
            'contractValidity': oldContractValidity,
            'classificationParameters': currentPlan.classificationParameters,
            '_class': planChangeClass
        },
        'newValue': {
            'plan': updatedContract.product,
            'components': updatedContract.productData,
            'billingDays': billingDays,
            'contractValidity': contractValidity,
            'classificationParameters': classificationParameters,
            '_class': planChangeClass
        },
        'date': eventDate,
        "observation": _input.observation ? _input.observation : null
    };

    if (simulate) {
        return params;
    }

    try {
        return billing.eventLog._create(params, { _indexStrategy: "queue" });
    } catch (exception) {
        throw _system._translation.getUnit({ bundle: "BILLING_MESSAGES", unit: "ERROR_EVENT_REGISTER_1", args: [contract._id, exception] })._current;
    }
}

/** Valida os status do contrato. */
function validateContractStates() {
    if (!contract.contractStates) {
        //Falha ao obter os status do contrato.
        throw _system._translation.getUnit({ bundle: "BILLING_MESSAGES", unit: "ERROR_GET_CONTRACT_STATUS" })._current;
    }

    // Contrato com status de serviço CANCELADO
    if (contract.contractStates.serviceState?.identifier === "CANCELLED") {
        //Não é possível alterar o plano de um contrato com status de serviço cancelado.
        throw _system._translation.getUnit({ bundle: "BILLING_MESSAGES", unit: "ERROR_CHANGE_PLAN" })._current;
    }
}

/**
 * Gera uma fatura no momento do upgrade do plano
 */
function invoiceContract(updatedContract, event, monthsToAdd) {
    return billing.contract.invoice({
        "_id": contract._id,
        "updatedContract": updatedContract,
        "referenceMonth": getReferenceMonth(updatedContract, eventDate, monthsToAdd),
        "generateProrataDiscounts": !ignoreProrataDiscounts,
        "keepReferenceDate": keepContractReferenceDate,
        "paymentCondition": _input.paymentCondition,
        "planUpgrade": generatePlanChangeInvoice ? isUpgrade : false,
        "planDowngrade": generatePlanChangeInvoice ? isDowngrade : false,
        "simulate": simulate,
        "event": event,
        "ignoreEventItems": _input.ignoreEventItems
    });
}

/**
 * Recuperar o mês de referência do atual ciclo de faturamento
 */
function getReferenceMonth(updatedContract, eventDate, monthsToaAdd = 0) {
    let newContract = updatedContract.billingDays ? updatedContract : contract;
    let referenceMonth = moment(eventDate);

    if (!generatePlanChangeInvoice && simulate) {
        if (moment(eventDate).date() > contract.billingDays.invoicingDay) {
            referenceMonth = referenceMonth.add(1, 'months');
        }
    } else if (moment(eventDate).date() < newContract.billingDays.invoicingDay) {
        referenceMonth = referenceMonth.subtract(1, 'months');
    }


    return moment(referenceMonth).add(monthsToaAdd, 'months').format('MM/YYYY');
}

/**
 * Atualiza a data de ativação dos componentes caso o plano tenha mudado
 */
function updateComponentsActivationDate(updatedContract, eventDate) {
    let referenceDate = getReferenceDate(eventDate);

    // Plano mantido
    if (!planChanged) {
        updatedContract.productData.forEach((component) => {
            let foundActive = false;
            // Percorre os itens anteriores do contrato, procurando se o componente já existia e estava ativo
            currentPlan.components.forEach(c => {
                if (c.planComponent._id === component.planComponent._id) {
                    if (c.active) {
                        foundActive = true;
                    }
                }
            });

            // O componente atual foi ativado
            if (component.active && !foundActive) {
                component.activationDate = eventDate;

                if (keepContractReferenceDate) {
                    component.referenceDate = referenceDate;
                } else {
                    referenceDate = moment(eventDate);

                    if (referenceDate.date() < contract.billingDays.billingDay) {
                        referenceDate = referenceDate.subtract(1, 'months');
                    }
                    component.referenceDate = new Date(referenceDate.date(contract.billingDays.billingDay));
                }
            } else if (!component.active && foundActive && ignoreProrataDiscounts) {
                // O componente atual foi inativado
                component.removed = true;
            }

            updateDiscountDate(component, eventDate);
        });

        return;
    }

    updatedContract?.productData?.filter(c => c.active).forEach(component => {
        component.activationDate = eventDate;
        component.referenceDate = eventDate;
        updateDiscountDate(component, new Date(eventDate));

        if (keepContractReferenceDate) {
            // A data de ativação não muda, pois quando se troca o plano,
            // se entende que o novo plano é ativado na momento da troca.
            component.referenceDate = referenceDate;
        } else if (generatePlanChangeInvoice) {
            let date = moment(eventDate).date(contract.billingDays.billingDay);

            if (moment(eventDate).date() < contract.billingDays.invoicingDay) {
                date = moment(date).subtract(1, 'months');
            }
            component.referenceDate = new Date(date);
        }
    });

    if (ignoreProrataDiscounts === true) {
        currentPlan.components.forEach(c => c.removed = true);
    }
}

/**
 * Adiciona a data de início e término do desconto
 */
function updateDiscountDate(component, date) {
    if (component.discount && component.discount.length > 0) {
        if (!component.discountData) {
            component.discountData = [];
        }

        component.discount.forEach(discount => {
            discount = com.sydle.billing.productCatalog.discount._get({ _id: discount._id });

            let discountData = {
                "discount": discount,
                "beginDate": date,
                "planChangeUpgrade": true
            };

            // Calculo da data de termino baseado nas parcelas
            let deal = discount.deal;
            let raterClass = deal?.rater?._id;
            let raterObject = deal?.rateRules;

            // Classes de tarifadores que tem parcelas: Percentual por parcela ou Valor por parcela
            if (raterClass === ("5d2cab40890466029d5da46c" || "5cadf554a50bfe4c0d3f1895")) {
                let parcel = 1;
                let periodicity = billing.periodicity._get({ _id: component.deal.periodicity._id }).value;

                // A quantidade de parcelas sera o campo end da ultima linha
                let parcels = raterObject.parcels.length;
                let lastParcel = raterObject.parcels[parcels - 1];

                // Caso a ultima parcela tenha apenas o inicio
                parcel = lastParcel.end ? lastParcel.end : lastParcel.begin;

                // Quantidade em meses das parcelas do desconto
                let multiplicity = periodicity * parcel;

                discountData.terminationDate = lastParcel.end && multiplicity ? moment(date).add(multiplicity, 'months').format() : null;
            }

            let tmpDiscount = component.discountData.find(d => d.discount._id === discount._id);

            if (!tmpDiscount) {
                component.discountData.push(discountData);
            }
        });
    }
}

/**
 * A data de referência do contrato é a data mais antiga dentre os componentes ativos
 * *
 */
function getReferenceDate(eventDate) {
    return currentPlan.components
        .filter(pd => pd.active && pd.referenceDate)
        .reduce((value, item) => moment(item.referenceDate).isBefore(value) ? item.referenceDate : value, eventDate);
}

/**
 * Caso o plano seja família, os planos dependentes são cancelados em caso de troca para um novo plano não família
 * Ou têm o plano atualizado
 */
function handleFamilyPlan(oldPlan, newPlan, contractValidity) {
    if (oldPlan.family) {
        if (!newPlan.family) {
            dependents.forEach(dependent => {
                billing.contract.suspendService({
                    "_id": dependent._id
                });

                billing.contract.cancelService({
                    "_id": dependent._id,
                    "cancellationReason": "DEPENDENT_REMOVAL"
                });
            });
        } else {
            let productData = newPlan.components.slice();
            productData.forEach(component => delete component.deal);

            let patchFamilyOperations = [{
                "op": "replace",
                "path": "/product",
                "value": newPlan.plan
            }, {
                "op": "replace",
                "path": "/productData/",
                "value": productData
            }];

            if (contractValidity) {
                patchFamilyOperations.push({
                    "op": "replace",
                    "path": "/contractValidity",
                    "value": contractValidity
                });
            }

            dependents.forEach(dependent => billing.contract._patch({
                '_id': dependent._id,
                '_operationsList': patchFamilyOperations,
                "readjust": _input.readjust
            }, { _indexStrategy: "queue" }));
        }
    }
}

/**
 * Verifica se a troca de plano família pode ser feita pelo número de dependentes
 */
function checkFamilyPlanChange() {
    if (currentPlan.plan.family) {
        dependents = getDependents();
        if (newPlan.plan.family && currentPlan.plan.dependentsMaxNumber < dependents.length) {
            //Seu plano família atual possui um número de dependentes maior que o número máximo do novo plano escolhido.
            throw _system._translation.getUnit({ bundle: "BILLING_MESSAGES", unit: "ERROR_MAX_NUMBER_DEPENDENTS" })._current;
        }
    }
}

function getDependents() {
    return billing.contract._search({
        "query": {
            "bool": {
                "must": [{
                    "term": {
                        "originContract._id": contract._id
                    }
                }],
                "must_not": [{
                    "term": {
                        "contractStates.serviceState._id": "59726365ce027221e44534ff"
                    }
                }]
            }
        },
        "size": contract.product.dependentsMaxNumber
    }).hits.hits.map(hit => hit._source);
}

function cancelUpgradeInvoices() {
    billing.invoice._search({
        "query": {
            "bool": {
                "must": [{
                    "nested": {
                        "path": "invoiceItem",
                        "query": {
                            "match": {
                                "invoiceItem.contract._id": contract._id
                            }
                        }
                    }
                }, {
                    "term": {
                        "invoiceState._id": "5977c001ce027227c4269e26"
                    }
                }, {
                    "term": {
                        "classification._id": "5e70d0288c19b766da08dd4f"
                    }
                }]
            }
        },
        "size": 1,
        "_source": false
    }).hits.hits.forEach(hit => {
        billing.invoice.cancel({ "_id": hit._id, "cancelRemittances": true });
    });
}

function validateIfHasActiveComponent() {
    if (newPlan && newPlan.components && newPlan.components.every(component => !component.active)) {
        throw _system._translation.getUnit({
            bundle: 'BILLING_MESSAGES',
            unit: 'ERROR_ACTIVE_COMPONENT_REQUIRED'
        })._current;
    }
}

function validateNewComponents(contract, newPlan) {
    let updatedContract = JSON.parse(_utils.stringifyAsJson(contract));
    updatedContract.productData = newPlan.components;

    if (updatedContract.productData && updatedContract.productData.length) {
        updatedContract.productData.forEach(item => {
            if (item?.planComponent?.relationshipRules?.length) {
                item.planComponent.relationshipRules.forEach(rule => {
                    const isValidComponents = !rule.additionalRule || isValidContext(rule.additionalRule, updatedContract);

                    if (!isValidComponents) {
                        throw _system._translation.getUnit({
                            bundle: 'BILLING_MESSAGES',
                            unit: 'ERROR_RELATIONSHIP_RULES_VIOLATED'
                        })._current;
                    }
                })
            }
        })
    }
}

// Verifica se o novo contrato é válido para os componentes.
// OBS: updatedContract é utilizado no eval, não remover!!!
function isValidContext(additionalRule, updatedContract) {
    let evalResult;
    try {
        evalResult = eval(additionalRule + "\n applyRule(updatedContract);");
    } catch (error) {
        // Caso a regra não seja bem formada, consideramos o contexto válido;
        evalResult = true;
    }
    return evalResult;
}

function getRelatedComponents(components) {
    const response = com.sydle.billing.productCatalog.planComponent.getRelatedComponents({ components: components });
    return response;
}
function getDependentComponents(requiredComponent) {
    const components = contract.productData.filter(component => component?.planComponent).map(component => component.planComponent);
    let dependentComponents = com.sydle.billing.productCatalog.planComponent.getDependentComponents({ component: requiredComponent, components: components });

    return dependentComponents;
}

function areSamePlan(oldPlan, newPlan) {
    const areSamePlan = oldPlan.plan?._id === newPlan?.plan?._id;
    const isSoftBundle = newPlan.plan?.bundleType === "soft";

    if (areSamePlan) {
        if (!isSoftBundle) {
            return true;
        }
        // Verifica se os componentes são os mesmos em ambos planos flexíveis. 
        else {
            const hasSameComponentsLength = oldPlan.components?.length === newPlan.components?.length;

            return hasSameComponentsLength &&
                newPlan.components?.every(component => {
                    return oldPlan.components.some(c => {
                        return component?.planComponent?._id === c?.planComponent?._id
                    });
                });
        }
    }

    // Caso o plano se mantenha, mas é flexível, então verificamos se os componentes foram alterados.
    return false;
}

function simulateNInvoices() {
    for (let i = 0; i < _input.invoiceQuantityToSimulate; i++) {
        let invoice = invoiceContract(updatedContract, (i === 0 ? event : null), i);

        _output.invoices.push(invoice);
    }
}