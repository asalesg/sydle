/**
 * Método de upgrade integrado com a Stripe seguindo o seguinte fluxo:.
 *  - Altera/cria informações necessárias para poder realizar a cobrança no contrato
 *  - Encaminha para o fluxo tradicional de upgrade
 * 
 * @input: {
 *      membership<Object> - assinatura para o upgrade, no método de tela vai ser o _object.
 *      accountPaymentData<Object> - objeto da classe Dados de pagamento de cliente / Billing, caso já exista o objeto basta passar o _id.
 *      address<object> - objeto da classe endereço que será vinculado ao contrato e à pessoa
 *      plansAvailableForUpgrade<object> - Novo plano para assinatura
 *      useRecordedCard<boolean> - Indica se cartão já cadastrado ou cartão novo será utilizado
 *      paymentData?<object> - Objeto da classe dados de pagamento de cliente, atualmente deve ser cartão de crédito. Necessário caso useRecordedCard === true
 *      createNewPaymentData?<object> - Objeto da classe dados de pagamento de cliente, atualmente deve ser cartão de crédito. Necessário caso useRecordedCard === false
 *      newPaymentMethod<Object> - Objeto da classe Forma de pagamento. Valor pode ser passado ou será definido automaticamente baseado no ambiente de uso.
 *      address?<object> - Objeto da classe Endereço/CRM. Necessário caso não haja endereço cadastrado para pessoa ou no contrato.
 *      validationButton<string> [confirm] - Valor para confirmar consentimento do cliente
 *  }
 * 
 */

/**
* @model Object = {
*  _id<string> - id do objeto
*  _classId<string> - id da classe do objeto
* }
*/

const ACTIVE_INVOICING_STATE_OBJ = { "_id": "5972637fce027221e4453503", "_classId": "59726305ce027221e44534ec" };
const ACTIVE_SERVICE_STATE_OBJ = { "_id": "59726354ce027221e44534fb", "_classId": "597262c7ce027221e44534e1" };

if (_input.upgradeForm.htmlField) return;

if (_input.upgradeForm.validationButton !== "confirm") {
  throw new ValidationException('Selecione o botão "Concordo com os termos" para poder continuar.', null, 'upgradeForm.validationButton');
}

if (!_input.upgradeForm.integrationLog.finishedSolicitation) {
  logs.PortalIntegrationLog._patch({
    _id: _input.upgradeForm.integrationLog._id,
    _operationsList: [{ op: 'replace', path: '/success', value: true }]
  });
}

try {
  let membership = _object || _input.upgradeForm.membership;

  registerPaymentData();
  contractPatch(membership.contract, _input.upgradeForm.address);
  personPatch(_input.upgradeForm.address);
  callStandartUpgrade();

  logs.PortalIntegrationLog._patch({
    _id: _input.upgradeForm.integrationLog._id,
    _operationsList: [{ op: 'replace', path: '/finishedSolicitation', value: true }]
  });

} catch (e) {
  logs.PortalIntegrationLog._patch({
    _id: _input.upgradeForm.integrationLog._id,
    _operationsList: [{ op: 'add', path: '/inputHistory/-', value: { "object": _utils.stringifyAsJson(_input), "error": e.message } }]
  });
}

//FUNCTIONS ----------------------------------------------------------------------------------------------------------------------

/**
 * @description Altera a forma de pagamento do contrato e, caso insira novo cartão, cria o antes de associar.
 * 
 * @throws Pode estourar os erros do billing mesmo
 * 
 */
function registerPaymentData() {
  try {
    let newAccountPaymentData = _input.upgradeForm.useRecordedCard ? _input.upgradeForm.paymentData : billing.accountPaymentData.create(_input.upgradeForm.createNewPaymentData);

    billing.contract.changePaymentMethod({
      _id: _object.contract._id,
      newPaymentData: newAccountPaymentData,
      newPaymentMethod: _input.upgradeForm.newPaymentMethod,
      changeInvoicesPaymentMethod: false,
      collectImmediately: false,
      cancelIssuedRemittances: false
    });

  } catch (e) {
    throw new Error(e.message);
  }
}


/**
 * @description Altera o status de faturamento e de serviço do contrato e insere o endereço de cobrança
 * 
 * @param {object} contract contrato para alteração
 * @param {object} billingAddress endereço de cobrança que será registrado no contrato
 */
function contractPatch(contract, billingAddress) {

  billing.contract._patch({
    _id: contract._id,
    _operationsList: [
      { op: 'replace', path: 'contractStates/invoicingState', value: ACTIVE_INVOICING_STATE_OBJ },
      { op: 'replace', path: 'contractStates/serviceState', value: ACTIVE_SERVICE_STATE_OBJ },
      { op: 'replace', path: 'billingAddress', value: billingAddress }
    ]
  });

}

function callStandartUpgrade() {
  const {
    useRecordedCard,
    paymentData,
    createNewPaymentData,
    newPaymentMethod,
    ...standartUpgradeInput
  } = _input;

  br.com.wevets.membershipManagement.Membership._extUpgrade({
    _object: _object,
    ...standartUpgradeInput
  });
}

function personPatch(newAddress) {
  const alreadyRegisteredAddress = _user.addresses.some(address =>
    address.zipCode === newAddress?.zipCode && address.number === newAddress?.number);

  if (newAddress && !alreadyRegisteredAddress) {
    crm.person._patch({
      _id: _user._id,
      _operationsList: [{ op: 'replace', path: 'addresses', value: [newAddress] }]
    });
  }
}