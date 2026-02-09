# RHDP-Flow TODO List

## Pending Features

### Interactive CSV Generation Wizard
- [ ] **Create an interactive wizard to help generate workshop schedule CSV files**
  - **Core Features:**
    - Interactive CLI wizard (using `input()` or a library like `inquirer` or `rich`)
    - Step-by-step guide through all required fields
    - Smart defaults and suggestions
    - Validation of inputs in real-time
    - Preview generated CSV before saving
    - Ability to add multiple workshops in one session
  
  - **Smart Logic & Intelligence:**
    - **CI Auto-detection:**
      - Query catalog to get available CIs and display them
      - Auto-detect if CI is multi-asset capable
      - Suggest appropriate settings based on CI type
      - Show CI metadata (description, typical duration, user limits)
    
    - **Time Intelligence:**
      - Calculate average provisioning time based on CI type
      - Suggest auto-stop time (e.g., provisioning + 6-8 hours for workshops)
      - Suggest auto-destroy time (e.g., auto-stop + 1-3 days)
      - Timezone handling (convert user input to UTC)
      - Validate dates are in the future
      - Check for scheduling conflicts
    
    - **Resource Intelligence:**
      - Check quota availability before suggesting user counts
      - Suggest optimal user counts based on CI limits
      - Warn if requesting too many resources
      - Check namespace availability
    
    - **Naming Intelligence:**
      - Auto-generate workshop names based on CI name + date
      - Suggest unique multi-workshop names
      - Validate Kubernetes name constraints
      - Check for naming conflicts
    
    - **Multi-Asset Intelligence:**
      - Suggest compatible asset combinations
      - Auto-detect if workshop should be multi-asset
      - Guide through asset selection with descriptions
      - Validate asset compatibility
    
    - **Best Practices:**
      - Suggest passwords (generate secure ones)
      - Recommend Activity/Purpose based on context
      - Warn about common mistakes
      - Suggest optimal scheduling times
    
  - **Implementation Approach:**
    - Create `rhdp_flow_wizard.py` or add `--wizard` mode to main script
    - Use `rich` library for beautiful CLI interface (progress bars, tables, colors)
    - Store historical data (provisioning times, success rates) in a local JSON file
    - Query cluster for real-time data (quota, available CIs, etc.)
    - Support both guided mode and quick-add mode
    - Allow editing existing CSV files
  
  - **Example Flow:**
    ```
    $ python3 rhdp_flow.py --wizard
    
    🎯 RHDP-Flow Workshop Scheduler Wizard
    ======================================
    
    1. Select Catalog Item:
       [1] openshift-cnv.ocp-virt-roadshow-multi-user.prod (Experience OpenShift Virtualization Roadshow)
       [2] zt-ansiblebu.ansible-network-automation-basics-lab-2.event
       [3] Enter custom CI...
    
    > 1
    
    ℹ️  CI Info:
       - Type: Multi-user Workshop
       - Typical Duration: 6-8 hours
       - Recommended Users: 20-40
       - Average Provision Time: ~5 minutes
    
    2. Enter number of users [20]: 
    > 20
    
    3. Select namespace:
       [1] user-bbethell-redhat-com (current)
       [2] Enter custom...
    > 1
    
    4. Enable Workshop UI? [Y/n]: 
    > Y
    
    5. Workshop Name [Experience OpenShift Virtualization Roadshow - 2026-02-09]: 
    > Billys Workshop
    
    6. Provisioning Date & Time (UTC):
       Date [09/02/2026]: 
       Time [11:00]: 
    
    7. Auto-stop time (suggested: 09/02/2026 18:00) [Y/n]:
    > Y
    
    8. Auto-destroy time (suggested: 12/02/2026 11:00) [Y/n]:
    > Y
    
    9. Password [Generate secure password? Y/n]: 
    > Y
    ✅ Generated: Billy1
    
    10. Activity [Admin]: 
    > Admin
    
    11. Purpose [QA]: 
    > QA
    
    12. Create multiple instances? [N/y]:
    > n
    
    ✅ Workshop configured!
    
    Add another workshop? [Y/n]:
    > n
    
    📄 Preview CSV:
    [Shows generated CSV]
    
    Save to file? [workshop_schedule.csv]: 
    > workshop_schedule.csv
    
    ✅ CSV saved! Run with: python3 rhdp_flow.py --input-csv workshop_schedule.csv
    ```

### Multiple Instance Support

(just like we do for 40 users of virt roadshow) 

so do 1 workshop - 2 workshop instances

Also for non multi user we need say 40 LLM's so need to deploy as a workshop and workshop count 40

- [ ] **Support multiple instances of the same workshop**
  - Add ability to create multiple instances of the same CI (e.g., 2x 20 user virt roadshows)
  - **Implementation approach:**
    - Add a "Count" field to CSV (optional, defaults to 1)



## Completed Features

- [x] Basic workshop scheduling via ResourceClaim
- [x] Workshop UI support (direct Workshop creation)
- [x] Multi-asset workshop support
- [x] Custom multi-workshop name from CSV
- [x] QA functions (QA1: setup verification, QA2: deployment status)
- [x] URL generation (link_to_service and landing_page_url)
- [x] Student landing page CSV export
- [x] WorkshopProvision creation for asset workshops
- [x] Proper catalog namespace detection for event items
