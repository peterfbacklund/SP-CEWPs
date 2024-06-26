ko.bindingHandlers.showModal = {
  init: function (
    element,
    valueAccessor,
    allBindings,
    viewModel,
    bindingContext
  ) {
    // This will be called when the binding is first applied to an element
    // Set up any initial state, event handlers, etc. here
  },
  update: function (
    element,
    valueAccessor,
    allBindings,
    viewModel,
    bindingContext
  ) {
    // This will be called once when the binding is first applied to an element,
    // and again whenever any observables/computeds that are accessed change
    // Update the DOM element based on the supplied values here.

    const value = ko.unwrap(valueAccessor());
    if (value) {
      element.showModal();
    } else {
      element.close();
    }
  },
};

const roleAssignmentsRequest =
  "_api/web/RoleAssignments?$expand=RoleDefinitionBindings,Member/Users";

class GroupReport {
  constructor() {
    document
      .getElementById("inputImportGroupsCsv")
      .addEventListener("change", this.clickViewImportModal);

    this.importProcessor = new ImportProcessor({
      siteRoleAssignments: this.siteRoleAssignments,
      siteRoleDefinitions: this.siteRoleDefinitions,
      siteOwnerGroup: this.siteOwnerGroup,
    });

    this.includeAll.subscribe(this.includeAllToggled);
  }

  showImportModal = ko.observable(false);
  chkRowPerUser = ko.observable(false);
  chkUserNameOnly = ko.observable(false);

  siteOwnerGroup = ko.observable();
  siteRoleAssignments = ko.observableArray();

  siteGroupsAssignments = ko.pureComputed(() => {
    return this.siteRoleAssignments().filter((roleAssignment) => {
      return roleAssignment.Member.PrincipalType == 8;
    });
  });

  requestUri = ko.observable();

  async submitRequest() {
    const result = await spFetch(this.requestUri());
    console.log(result.value);
  }

  async init() {
    await this.fetchRoleAssignments();
    await this.fetchSiteRoleDefs();

    await populateEnsuredUsers();

    const siteOwnerResult = await spFetch("_api/web/AssociatedOwnerGroup");

    if (siteOwnerResult.isFailure()) {
      console.error("no site owner!");
      return;
    }
    this.siteOwnerGroup(siteOwnerResult.value);
  }

  formatUsersItem(user) {
    return `${user.Title} (${user.Email})`;
  }

  formatUsersCellExport(groupAssignment) {
    const users = groupAssignment.Member.Users.results;
    const usernameOnly = this.chkUserNameOnly();

    return users
      .map((user) =>
        usernameOnly ? user.Email?.split("@")[0] ?? null : user.LoginName
      )
      .filter((user) => user)
      .join("; ");
  }

  formatPermissionsCellExport(groupAssignment) {
    return groupAssignment.RoleDefinitionBindings.results
      .map((role) => role.Name)
      .join("; ");
  }

  async fetchRoleAssignments() {
    const result = await spFetch(roleAssignmentsRequest);
    if (result.isFailure()) {
      console.log(result.error);
      return;
    }
    this.siteRoleAssignments(result.value.results);
  }

  clickViewExportModal() {
    document.getElementById("dlgExportView").showModal();
  }

  clickCloseExportModal() {
    document.getElementById("dlgExportView").close();
  }

  clickExportSiteGroups() {
    const fileName =
      _spPageContextInfo.webTitle +
      "-SiteGroups_" +
      new Date().format("yyyy-MM-dd");
    exportToCsv(fileName, "tblSiteGroupsExport", false);
  }

  // IMPORT
  siteRoleDefinitions = ko.observableArray();
  async fetchSiteRoleDefs() {
    const roleDefsUrl = "_api/web/roledefinitions";
    const result = await spFetch(roleDefsUrl);
    if (result.isFailure()) {
      console.error("No role defs");
      return;
    }

    this.siteRoleDefinitions(result.value.results);
  }

  includeAll = ko.observable(false);
  importSiteGroupsValidationResults = ko.observableArray();
  failedImports = ko.observableArray();

  includeAllToggled = (val) => {
    const validationResults = ko.unwrap(this.importSiteGroupsValidationResults);
    validationResults.map((validationResult) => {
      validationResult.includeInImport(val);
    });
  };

  clickViewImportModal = async () => {
    const fileInput = document.getElementById("inputImportGroupsCsv");
    const file = fileInput.files[0];
    if (!file) return;
    this.failedImports.removeAll();
    const result = await convertFromCsv(file);
    const validationResults = await this.importProcessor.validateInput(result);
    this.importSiteGroupsValidationResults(validationResults);
    this.showImportModal(true);
    fileInput.value = null;
  };

  clickCloseImportModal() {
    this.showImportModal(false);
    // Reload
    this.init();
  }

  async clickImportSiteGroups() {
    // this.failedImports.removeAll();
    const groupValidationResults = ko.unwrap(
      this.importSiteGroupsValidationResults
    );
    const groupsToImport = groupValidationResults.filter((result) =>
      result.includeInImport()
    );
    const failedResults = await this.importProcessor.submitValidationResults(
      groupsToImport
    );
    ko.utils.arrayPushAll(this.failedImports, failedResults);
  }

  clickClearImportResults = () => {
    this.failedImports.removeAll();
  };
  clickExportImportResults = () => {
    const fileName =
      _spPageContextInfo.webTitle +
      "-SiteGroupsImportResults_" +
      new Date().format("yyyy-MM-dd");
    exportToCsv(fileName, "tblSiteGroupsImportResults", false);
  };

  static async Create() {
    const newReport = new GroupReport();
    await newReport.init();
    return newReport;
  }
}

class ImportProcessor {
  constructor({ siteRoleAssignments, siteRoleDefinitions, siteOwnerGroup }) {
    this.siteRoleAssignments = siteRoleAssignments;
    this.siteRoleDefinitions = siteRoleDefinitions;
    this.siteOwnerGroup = siteOwnerGroup;
  }

  getSiteGroupByNameUrl = (groupName) =>
    `_api/web/SiteGroups/GetByName('${groupName}')?$expand=Users`;

  getRoleAssignmentByGroupIdUrl = (groupId) =>
    `_api/web/RoleAssignments/GetByPrincipalId('${groupId}')?$expand=RoleDefinitionBindings,Member/Users`;

  async validateInput(inputArr) {
    // Check if our inputArr was generated using one user per row
    if ("Email" in inputArr[0]) {
    }
    const siteRoleAssignments = ko.unwrap(this.siteRoleAssignments);
    const validationResults = [];
    for (const importGroup of inputArr) {
      let validationResult = validationResults.find(
        (result) => result.title == importGroup.Title
      );
      if (validationResult) {
        await validationResult.addGroupItemUsers(importGroup);
        continue;
      }

      validationResult = new GroupValidationResult(importGroup);

      // 1. validate group exists
      const existingGroup = await this.findGroupByName(importGroup.Title);
      await validationResult.setExistingGroup(existingGroup);

      // 2. validate permissions
      const existingRoleAssignment = await this.findRoleAssignmentByGroupId(
        existingGroup?.Id
      );
      validationResult.setExistingRoleDefinitions(existingRoleAssignment);
      validationResults.push(validationResult);
    }

    return validationResults;
  }

  async submitValidationResults(groupValidationResults) {
    for (let groupValidationResult of groupValidationResults) {
      await this.submitValidationResult(groupValidationResult);
    }

    const failedResults = groupValidationResults.filter((result) =>
      [
        GroupValidationResult.STATES.FAILURE,
        GroupValidationResult.STATES.PARTIAL,
      ].includes(result.status())
    );
    return failedResults;
  }

  async submitValidationResult(groupValidationResult) {
    // 1. If group does not exist, create it
    let siteGroup = groupValidationResult.existingGroup;
    groupValidationResult.status(GroupValidationResult.STATES.PENDING);
    if (!siteGroup) {
      const result = await this.createGroup(groupValidationResult.title);
      if (!result.isSuccess()) {
        groupValidationResult.status(GroupValidationResult.STATES.FAILURE);
        groupValidationResult.msg(result.error);
        return;
      }
      siteGroup = result.value;
    }

    // 2. Add users to Group
    await Promise.all(
      groupValidationResult.newStagedUsers().map(async (stagedUser) => {
        stagedUser.status(StagedUser.STATES.PENDING);
        const result = await this.addUserToGroup(
          siteGroup,
          stagedUser.LoginName
        );
        stagedUser.setStatusFromResult(result);
        if (!result.isSuccess()) {
          groupValidationResult.setPartialError(result);
          return;
        }
      })
    );

    // 2.a Remove users from Group
    await Promise.all(
      groupValidationResult.removedStagedUsers().map(async (stagedUser) => {
        stagedUser.status(StagedUser.STATES.PENDING);
        const result = await this.removeUserFromGroup(siteGroup, stagedUser);
        stagedUser.setStatusFromResult(result);
        if (!result.isSuccess()) {
          groupValidationResult.setPartialError(result);
          return;
        }
      })
    );

    // 3. Add Roles to Group
    await Promise.all(
      groupValidationResult
        .newStagedRoleDefinitions()
        .map(async (stagedRoleDef) => {
          stagedRoleDef.status(StagedRoleDefinition.STATES.PENDING);
          const result = await this.addRoleToGroup(
            siteGroup,
            stagedRoleDef.roleDefinitionKey
          );
          stagedRoleDef.setStatusFromResult(result);
          if (!result.isSuccess()) {
            groupValidationResult.setPartialError(result);
            return;
          }
        })
    );

    if (
      groupValidationResult.status() == GroupValidationResult.STATES.PENDING
    ) {
      groupValidationResult.status(GroupValidationResult.STATES.SUCCESS);
    }
  }

  async findGroupByName(groupName) {
    const siteRoleAssignments = ko.unwrap(this.siteRoleAssignments);

    // 1. Check our siteRoleAssignments
    const existingAssignment = siteRoleAssignments.find(
      (assignment) => assignment.Member.Title == groupName
    );
    if (existingAssignment) return existingAssignment.Member;

    // 2. Else, query the site
    const existingGroupResult = await spFetch(
      this.getSiteGroupByNameUrl(groupName)
    );
    if (existingGroupResult.isSuccess()) return existingGroupResult.value;

    return null;
  }

  async findRoleAssignmentByGroupId(groupId) {
    if (!groupId) return null;
    const siteRoleAssignments = ko.unwrap(this.siteRoleAssignments);

    // 1. Check our siteRoleAssignments
    const existingAssignment = siteRoleAssignments.find(
      (assignment) => assignment.PrincipalId == groupId
    );
    if (existingAssignment) return existingAssignment;

    // 2. Else, query the site
    //const roleAssignment = await fetch()
  }

  async createGroup(groupName) {
    const siteOwnerGroup = ko.unwrap(this.siteOwnerGroup);
    const addGroupUrl = `_api/web/SiteGroups`;

    const requestParams = {
      body: {
        __metadata: { type: "SP.Group" },
        Title: groupName,
        OnlyAllowMembersViewMembership: false,
      },
    };

    const result = await spFetch(addGroupUrl, "POST", requestParams);
    if (result.isFailure()) return result;

    const group = result.value;

    const setOwnerResult = await this.setGroupOwner(group, siteOwnerGroup);
    return setOwnerResult;
  }

  async setGroupOwner(group, owner) {
    const currCtx = new SP.ClientContext.get_current();
    const web = currCtx.get_web();

    const oGroup = web.get_siteGroups().getById(group.Id);
    oGroup.set_owner(web.get_associatedOwnerGroup());

    oGroup.update();
    await executeQuery(currCtx).catch((e) => {
      return Result.Failure(e);
    });

    return Result.Success(group);
  }

  async addUserToGroup(group, userKey) {
    const addUserUrl = `_api/web/SiteGroups(${group.Id})/users`;
    const requestParams = {
      headers: {
        "content-type": "application/json; odata=verbose",
      },
      body: {
        __metadata: { type: "SP.User" },
        LoginName: userKey,
      },
    };

    const result = await spFetch(addUserUrl, "POST", requestParams);
    return result;
  }

  async removeUserFromGroup(group, user) {
    const uri = `_api/web/SiteGroups(${group.Id})/users/removeById('${user.Id}')`;
    const requestParams = {
      headers: {
        "content-type": "application/json; odata=verbose",
        "X-HTTP-Method": "DELETE",
      },
    };

    const result = await spFetch(uri, "POST", requestParams);
    return result;
  }

  async addRoleToGroup(group, roleDefinitionKey) {
    const siteRoleDefinitions = ko.unwrap(this.siteRoleDefinitions);
    const roleDef = siteRoleDefinitions.find(
      (siteRoleDef) => siteRoleDef.Name == roleDefinitionKey
    );

    if (!roleDef)
      return Result.Failure("Role Definition Not found: " + roleDefinitionKey);

    const addRoleUrl =
      `_api/web/RoleAssignments/` +
      `AddRoleAssignment(PrincipalId='${group.Id}',RoleDefId='${roleDef.Id}')`;

    return await spFetch(addRoleUrl, "POST");
  }
}

class GroupValidationResult {
  constructor(group) {
    this.title = group.Title;
    this.addGroupItemUsers(group);

    this.importPermissions =
      group.Permissions !== "" ? group.Permissions?.split("; ") ?? [] : [];
  }
  includeInImport = ko.observable();
  status = ko.observable();
  msg = ko.observable();

  existingRoleDefinitions = [];
  existingGroup;
  existingUsers = [];

  ensuredUsers = {};

  title;
  importUserKeys = [];
  importPermissions = [];

  userkeysNotFound = ko.observableArray();

  newStagedUsers = ko.observableArray();
  removedStagedUsers = ko.observableArray();

  newStagedRoleDefinitions = ko.observableArray();

  addGroupItemUsers = async (group) => {
    // If the group item has an email column, this was exported one row per user
    if (!group.hasOwnProperty("Email")) {
      const newUsers = group.Users !== "" ? group.Users?.split("; ") ?? [] : [];

      this.importUserKeys.push(...newUsers);
    } else if (group.Email) {
      this.importUserKeys.push("i:0#.f|membership|" + group.Email);
    }

    await this.updateStagedUsers();
  };

  updateStagedUsers = async () => {
    // Ensure all users, track those that can't be ensured
    const newEnsuredUsers = [];
    // this.userkeysNotFound = [];

    await Promise.all(
      this.importUserKeys.map(async (key) => {
        // If we've already ensured this one
        if (this.userkeysNotFound().includes(key)) return;

        const ensured = await ensureUser(key);
        if (ensured) {
          newEnsuredUsers.push(ensured);
          return;
        }
        this.userkeysNotFound.push(key);
      })
    );

    const newEnsuredLoginNames = newEnsuredUsers.map((u) => u.LoginName);

    this.newStagedUsers(
      newEnsuredUsers
        .filter((user) => !this.userInGroup(user.LoginName))
        .map((user) => {
          return new StagedUser(user);
        })
    );

    this.removedStagedUsers(
      this.existingGroup?.Users?.results
        ?.filter((user) => !newEnsuredLoginNames.includes(user.LoginName))
        .map((u) => new StagedUser(u))
    );
  };

  failedStagedUsersText = ko.pureComputed(() => {
    return this.newStagedUsers()
      .filter((user) => user.status() == StagedUser.STATES.FAILURE)
      .map((user) => `${user.userKey}: ${user.msg()}`)
      .join("; ");
  });

  failedStagedPermsText = ko.pureComputed(() => {
    return this.newStagedRoleDefinitions()
      .filter(
        (roleDef) => roleDef.status() == StagedRoleDefinition.STATES.FAILURE
      )
      .map((roleDef) => `${roleDef.roleDefinitionKey}: ${roleDef.msg()}`)
      .join("; ");
  });

  importFailures = ko.pureComputed(() => {
    const failures = [];

    if (this.status() == GroupValidationResult.STATES.FAILURE)
      failures.push({
        group: this.title,
        source: "group",
        value: this.title,
        error: this.msg(),
      });

    this.newStagedUsers()
      .filter((user) => user.status() == StagedUser.STATES.FAILURE)
      .map((user) =>
        failures.push({
          group: this.title,
          source: "user add",
          value: user.userKey,
          error: user.msg(),
        })
      );

    this.removedStagedUsers()
      .filter((user) => user.status() == StagedUser.STATES.FAILURE)
      .map((user) =>
        failures.push({
          group: this.title,
          source: "user remove",
          value: user.userKey,
          error: user.msg(),
        })
      );

    this.newStagedRoleDefinitions()
      .filter(
        (roleDef) => roleDef.status() == StagedRoleDefinition.STATES.FAILURE
      )
      .map((roleDef) =>
        failures.push({
          group: this.title,
          source: "roledef",
          value: roleDef.roleDefinitionKey,
          error: roleDef.msg(),
        })
      );

    return failures;
  });

  async setExistingGroup(group) {
    if (group) {
      this.existingGroup = group;
      this.existingUsers = group.Users.results;
    }

    await this.updateStagedUsers();
  }

  setExistingRoleDefinitions(roleAssignment) {
    if (roleAssignment) {
      this.existingRoleDefinitions =
        roleAssignment.RoleDefinitionBindings.results;
    }

    this.newStagedRoleDefinitions(
      this.importPermissions
        .filter((roleDef) => !this.groupHasPermission(roleDef))
        .map((roleDef) => new StagedRoleDefinition(roleDef))
    );
  }

  userInGroup(userKey) {
    return this.existingGroup?.Users?.results?.find(
      (existingUser) => existingUser.LoginName == userKey
    );
  }

  groupHasPermission(permissionKey) {
    return this.existingRoleDefinitions?.find(
      (role) => role.Name == permissionKey
    );
  }

  setPartialError(result) {
    if (result.isSuccess()) return;
    this.status(GroupValidationResult.STATES.PARTIAL);
    this.msg(result.error);
    return;
  }

  static STATES = {
    PENDING: "pending",
    PARTIAL: "partial",
    SUCCESS: "success",
    FAILURE: "failure",
  };
}

class StagedUser {
  constructor(user) {
    Object.assign(this, user);
    this.userKey = user.Email.split("@")[0] ?? user.LoginName;
  }

  status = ko.observable();
  msg = ko.observable();

  setStatusFromResult(result) {
    if (!result.isSuccess()) {
      this.status(StagedUser.STATES.FAILURE);
      this.msg(result.error);
      return;
    }
    this.status(StagedUser.STATES.SUCCESS);
  }

  static STATES = {
    PENDING: "pending",
    SUCCESS: "success",
    FAILURE: "failure",
  };
}

class StagedRoleDefinition {
  constructor(roleDefinitionKey) {
    this.roleDefinitionKey = roleDefinitionKey;
  }

  status = ko.observable();
  msg = ko.observable();

  setStatusFromResult(result) {
    if (!result.isSuccess()) {
      this.status(StagedRoleDefinition.STATES.FAILURE);
      this.msg(result.error);
      return;
    }
    this.status(StagedRoleDefinition.STATES.SUCCESS);
  }

  static STATES = {
    PENDING: "pending",
    SUCCESS: "success",
    FAILURE: "failure",
  };
}

class Result {
  _success;
  error;
  isSuccess = () => this._success;
  isFailure = () => !this.isSuccess();

  static Success(value) {
    const result = new Result();
    result.value = value;
    result._success = true;
    return result;
  }

  static Failure(error) {
    const result = new Result();
    result._success = false;
    result.error = error;
    return result;
  }
}

const ensuredUsers = {};

async function populateEnsuredUsers() {
  const result = await spFetch("_api/web/siteusers");

  if (!result.isSuccess()) {
    alert("Unable to populate site users");
    return;
  }

  result.value.results
    .filter((u) => u.Email)
    .map((u) => {
      const userKey = u.Email.split("@")[0];
      ensuredUsers[userKey] = u;
    });
}

async function ensureUser(userKey) {
  if (ensuredUsers.hasOwnProperty(userKey)) {
    return ensuredUsers[userKey];
  }

  const uri = `_api/web/ensureuser('${userKey}')`;
  const result = await spFetch(uri, "POST");

  ensuredUsers[userKey] = result.isSuccess() ? result.value : null;

  return ensuredUsers[userKey];
}

async function createReport() {
  const newReport = await GroupReport.Create();
  ko.applyBindings(newReport);
}

createReport();

async function spFetch(url, method = "GET", params = {}) {
  const siteEndpoint = url.startsWith("http")
    ? url
    : _spPageContextInfo.webAbsoluteUrl + "/" + url;

  if (params.body) {
    params.body = JSON.stringify(params.body);
  }
  const requestParams = {
    ...params,
    method,
    headers: {
      Accept: "application/json; odata=verbose;charset=utf-8",
      "content-type": "application/json; odata=verbose;charset=utf-8",
      "X-RequestDigest": document.getElementById("__REQUESTDIGEST").value,
      ...params?.headers,
    },
  };
  const response = await fetch(siteEndpoint, requestParams);

  // if (!response.ok) {
  //   if (response.status == 404) {
  //     return;
  //   }
  //   console.error(response);
  // }
  const result = await response.json();
  if (response.ok) return Result.Success(result.d);

  return Result.Failure(result.error?.message?.value);
}

function executeQuery(currCtx) {
  return new Promise((resolve, reject) =>
    currCtx.executeQueryAsync(resolve, (sender, args) => {
      reject({ sender, args });
    })
  );
}

//make sure iframe with id csvexprframe is added to page up top
//http://stackoverflow.com/questions/18185660/javascript-jquery-exporting-data-in-csv-not-working-in-ie
function exportToCsv(fileName, tableName, removeHeader) {
  var data = getCellValues(tableName);

  if (!data) {
    alert("No data!");
    return;
  }

  if (removeHeader == true) data = data.slice(1);

  var csv = convertToCsv(data);
  //	console.log( csv );

  var uri = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  var downloadLink = document.createElement("a");
  downloadLink.href = uri;
  downloadLink.download = fileName + ".csv";
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

function getCellValues(tableName) {
  var table = document.getElementById(tableName);

  if (!table) return;

  var tableArray = [];
  for (var r = 0, n = table.rows.length; r < n; r++) {
    tableArray[r] = [];
    for (var c = 0, m = table.rows[r].cells.length; c < m; c++) {
      var text =
        table.rows[r].cells[c].textContent || table.rows[r].cells[c].innerText;
      tableArray[r][c] = text.trim();
    }
  }
  return tableArray;
}

function convertToCsv(objArray) {
  var array = typeof objArray != "object" ? JSON.parse(objArray) : objArray;
  var str = "sep=,\r\n";
  var line = "";
  var index;
  var value;
  for (var i = 0; i < array.length; i++) {
    line = "";
    var array1 = array[i];
    for (index in array1) {
      if (array1.hasOwnProperty(index)) {
        value = array1[index] + "";
        line += '"' + value.replace(/"/g, '""') + '",';
      }
    }
    line = line.slice(0, -1);
    str += line + "\r\n";
  }
  return str;
}

async function convertFromCsv(file) {
  // Take a file object (e.g. from file input) and convert to array of objects
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const carriageReturn = "\r\n";
        const lines = reader.result.split(carriageReturn);
        let separator = ",";

        // Remove the 'sep=,' line
        if (lines[0].toLowerCase().startsWith("sep=")) lines.shift();
        const headerLine = lines.shift();
        const headers = getCsvValuesFromLine(headerLine, separator);

        const allObjects = [];
        for (const line of lines) {
          const lineObj = {};
          const values = getCsvValuesFromLine(line, separator);
          let isNotEmpty = false;

          for (const header of headers) {
            lineObj[header] = values.shift();
            // For some reason we end up with an empty row?
            if (lineObj[header]) isNotEmpty = true;
          }
          if (isNotEmpty) allObjects.push(lineObj);
        }
        resolve(allObjects);
      };
      // start reading the file. When it is done, calls the onload event defined above.
      reader.readAsBinaryString(file);
    } catch (e) {
      reject(e);
    }
  });
}

function getCsvValuesFromLine(line, separator = ",") {
  return line.split(separator).map(function (value) {
    return value.replace(/\"/g, "");
  });
}
